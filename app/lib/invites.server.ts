import { eq, sql } from "drizzle-orm";
import { getDb } from "~/db";
import type { Invite } from "~/db/schema";
import { invites } from "~/db/schema";
import { timingSafeEqual } from "./tokens";

/**
 * Invite resolution — PLAN.md §5/§6.
 *
 * Two kinds:
 *   'upload'  — anonymous, no account. Someone sends me a file. Burns after max_uploads.
 *   'account' — email + OTP + passkey, produces a member who can upload whenever.
 */

export type InviteRejection = "missing" | "revoked" | "expired" | "used";

export type InviteResolution =
	| { ok: true; invite: Invite }
	| { ok: false; reason: InviteRejection };

export async function resolveInvite(env: Env, code: string): Promise<InviteResolution> {
	// Reject implausible input before touching the database.
	if (!code || code.length > 64) return { ok: false, reason: "missing" };

	const invite = await getDb(env)
		.select()
		.from(invites)
		.where(eq(invites.code, code))
		.get();

	// Defence in depth: the row was found by an indexed equality match, which is not a
	// constant-time operation. Compare again in constant time so the decision itself leaks
	// nothing, and rate-limit the route (§7) to make guessing pointless regardless.
	if (!invite || !timingSafeEqual(invite.code, code)) {
		return { ok: false, reason: "missing" };
	}
	if (invite.revokedAt !== null) return { ok: false, reason: "revoked" };
	if (invite.expiresAt !== null && invite.expiresAt <= Date.now()) {
		return { ok: false, reason: "expired" };
	}

	if (invite.kind === "upload") {
		const limit = invite.maxUploads ?? 1;
		if (invite.uses >= limit) return { ok: false, reason: "used" };
	} else if (invite.claimedAt !== null) {
		return { ok: false, reason: "used" };
	}

	return { ok: true, invite };
}

/**
 * Records one consumed upload against an invite. Guarded in the WHERE clause so two
 * simultaneous uploads can't both slip past a single-use invite.
 *
 * Called on upload *completion*, never at intent — a cancelled upload must not burn an invite.
 */
export async function consumeInviteUse(env: Env, inviteId: string): Promise<boolean> {
	const result = await getDb(env).run(sql`
		update invites
		   set uses = uses + 1
		 where id = ${inviteId}
		   and revoked_at is null
		   and (expires_at is null or expires_at > ${Date.now()})
		   and uses < coalesce(max_uploads, 1)
	`);
	return (result.meta?.changes ?? 0) > 0;
}
