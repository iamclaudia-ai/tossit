import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "~/db";
import { files, invites, otpCodes, sessions, webauthnChallenges } from "~/db/schema";
import { purgeExpiredDeviceAuths } from "./device.server";
import { abortMultipartUpload, deleteObject, getR2Config } from "./r2";

/**
 * Daily housekeeping — PLAN.md §7. Runs from the cron trigger.
 *
 * The expensive item is abandoned uploads: R2 bills for the parts of a multipart upload that
 * was never completed or aborted, and nothing else in the system ever cleans those up.
 */

/** A pending upload older than this is never going to finish. */
const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;
/** How long a deleted file's row is kept so its slug can never be reissued. */
const TOMBSTONE_MS = 90 * 24 * 60 * 60 * 1000;

export interface CleanupReport {
	expiredFiles: number;
	staleUploads: number;
	tombstones: number;
	sessions: number;
	otpCodes: number;
	challenges: number;
	invites: number;
	deviceAuths: number;
	errors: string[];
}

export async function runCleanup(env: Env): Promise<CleanupReport> {
	const db = getDb(env);
	const config = getR2Config(env);
	const now = Date.now();
	const report: CleanupReport = {
		expiredFiles: 0,
		staleUploads: 0,
		tombstones: 0,
		sessions: 0,
		otpCodes: 0,
		challenges: 0,
		invites: 0,
		deviceAuths: 0,
		errors: [],
	};

	// 1. Expired files — the link already 404s; this reclaims the storage behind it.
	const expired = await db
		.select()
		.from(files)
		.where(
			and(
				eq(files.status, "complete"),
				isNull(files.deletedAt),
				isNotNull(files.expiresAt),
				lt(files.expiresAt, now),
			),
		)
		.limit(500);

	for (const file of expired) {
		try {
			await deleteObject(config, file.r2Key);
			await db
				.update(files)
				.set({ deletedAt: now, status: "aborted" })
				.where(eq(files.id, file.id));
			report.expiredFiles++;
		} catch (error) {
			report.errors.push(`expired ${file.id}: ${(error as Error).message}`);
		}
	}

	// 2. Abandoned uploads. Orphaned multipart parts are billable indefinitely.
	const stale = await db
		.select()
		.from(files)
		.where(and(eq(files.status, "pending"), lt(files.createdAt, now - STALE_UPLOAD_MS)))
		.limit(500);

	for (const file of stale) {
		try {
			if (file.multipartId) {
				await abortMultipartUpload(config, file.r2Key, file.multipartId);
			} else {
				await deleteObject(config, file.r2Key);
			}
			await db.delete(files).where(eq(files.id, file.id));
			report.staleUploads++;
		} catch (error) {
			report.errors.push(`stale ${file.id}: ${(error as Error).message}`);
		}
	}

	// 3. Long-dead tombstones. Kept this long only so a slug can't be reissued while any old
	//    link might still be circulating.
	const tombstones = await db.run(sql`
		delete from files
		 where deleted_at is not null
		   and deleted_at < ${now - TOMBSTONE_MS}
	`);
	report.tombstones = tombstones.meta?.changes ?? 0;

	// 4. Short-lived auth records.
	const deadSessions = await db
		.delete(sessions)
		.where(or(lt(sessions.expiresAt, now), isNotNull(sessions.revokedAt)));
	report.sessions = deadSessions.meta?.changes ?? 0;

	const deadOtps = await db
		.delete(otpCodes)
		.where(or(lt(otpCodes.expiresAt, now), isNotNull(otpCodes.consumedAt)));
	report.otpCodes = deadOtps.meta?.changes ?? 0;

	const deadChallenges = await db
		.delete(webauthnChallenges)
		.where(lt(webauthnChallenges.expiresAt, now));
	report.challenges = deadChallenges.meta?.changes ?? 0;

	// 5. Spent invites. Claimed account invites are kept — they record who claimed what.
	const deadInvites = await db
		.delete(invites)
		.where(
			and(
				isNull(invites.claimedAt),
				or(lt(invites.expiresAt, now - TOMBSTONE_MS), isNotNull(invites.revokedAt)),
			),
		);
	report.invites = deadInvites.meta?.changes ?? 0;

	// Stale login requests, including any token that was approved but never collected.
	report.deviceAuths = await purgeExpiredDeviceAuths(env);

	return report;
}
