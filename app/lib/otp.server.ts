import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "~/db";
import { otpCodes } from "~/db/schema";
import { generateOtp, sha256, timingSafeEqual } from "./tokens";

/**
 * Email one-time codes. These exist for exactly one purpose: proving someone controls the
 * address on an account invite. They are never a sign-in method — that's passkeys only.
 */

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

/** PLAN.md §7: 3 per email per 15 min, 10 per IP per hour. */
const EMAIL_WINDOW_MS = 15 * 60 * 1000;
const EMAIL_LIMIT = 3;

export type OtpIssue = { ok: true; code: string } | { ok: false; error: string };

export async function issueOtp(
	env: Env,
	email: string,
	inviteId: string,
): Promise<OtpIssue> {
	const db = getDb(env);
	const now = Date.now();

	const recent = await db
		.select({ count: sql<number>`count(*)` })
		.from(otpCodes)
		.where(
			and(
				eq(otpCodes.email, email),
				gt(otpCodes.expiresAt, now - EMAIL_WINDOW_MS + OTP_TTL_MS),
			),
		)
		.get();

	if ((recent?.count ?? 0) >= EMAIL_LIMIT) {
		return { ok: false, error: "Too many codes requested. Try again in a few minutes." };
	}

	// Any earlier code for this address stops working the moment a new one is sent, so a
	// forwarded or shoulder-surfed older code is dead.
	await db
		.update(otpCodes)
		.set({ consumedAt: now })
		.where(and(eq(otpCodes.email, email), isNull(otpCodes.consumedAt)));

	const code = generateOtp();
	await db.insert(otpCodes).values({
		id: nanoid(),
		email,
		codeHash: await sha256(code),
		inviteId,
		attempts: 0,
		expiresAt: now + OTP_TTL_MS,
	});

	return { ok: true, code };
}

export type OtpCheck = { ok: true } | { ok: false; error: string };

/**
 * Verifies and consumes a code. Attempts are counted on the row, and blowing the budget
 * invalidates the code outright rather than merely slowing the attacker down.
 */
export async function verifyOtp(
	env: Env,
	email: string,
	inviteId: string,
	submitted: string,
): Promise<OtpCheck> {
	const db = getDb(env);
	const now = Date.now();

	const record = await db
		.select()
		.from(otpCodes)
		.where(
			and(
				eq(otpCodes.email, email),
				eq(otpCodes.inviteId, inviteId),
				isNull(otpCodes.consumedAt),
			),
		)
		.get();

	// One message for every failure mode: no code, wrong code, expired, spent. Distinguishing
	// them would confirm which addresses have a code outstanding.
	const rejected: OtpCheck = {
		ok: false,
		error: "That code isn't right. Check it and try again.",
	};

	if (!record) return rejected;
	if (record.expiresAt <= now) return rejected;

	if (record.attempts >= MAX_ATTEMPTS) {
		await db.update(otpCodes).set({ consumedAt: now }).where(eq(otpCodes.id, record.id));
		return { ok: false, error: "Too many attempts. Request a new code." };
	}

	const submittedHash = await sha256(submitted.trim());
	if (!timingSafeEqual(record.codeHash, submittedHash)) {
		await db
			.update(otpCodes)
			.set({ attempts: record.attempts + 1 })
			.where(eq(otpCodes.id, record.id));
		return rejected;
	}

	await db.update(otpCodes).set({ consumedAt: now }).where(eq(otpCodes.id, record.id));
	return { ok: true };
}

/** Loose sanity check — real validation is whether the code in the inbox comes back. */
export function looksLikeEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}
