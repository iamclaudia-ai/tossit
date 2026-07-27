import { eq, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "~/db";
import { webauthnChallenges } from "~/db/schema";
import { getRequestOrigin } from "./origin";

/**
 * WebAuthn plumbing shared by registration and authentication.
 *
 * rpID and origin are derived from the incoming request so local dev works on
 * http://localhost:5173 without a tunnel, while production pins to tossit.sh. They MUST match
 * what the browser saw or verification fails with an opaque error.
 */

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface RpConfig {
	rpID: string;
	rpName: string;
	origin: string;
}

export function getRpConfig(request: Request): RpConfig {
	const url = new URL(request.url);
	return {
		// rpID is a bare domain — no port, no scheme. localhost is valid as-is.
		rpID: url.hostname,
		rpName: "tossit.sh",
		// Not url.origin: behind a TLS-terminating proxy that reports http. See origin.ts.
		origin: getRequestOrigin(request),
	};
}

export async function storeChallenge(
	env: Env,
	challenge: string,
	kind: "registration" | "authentication",
	email?: string,
): Promise<string> {
	const db = getDb(env);
	const id = nanoid();
	await db.insert(webauthnChallenges).values({
		id,
		challenge,
		kind,
		email: email ?? null,
		expiresAt: Date.now() + CHALLENGE_TTL_MS,
	});
	return id;
}

/**
 * Reads a challenge and deletes it in the same call — a challenge is single-use, and leaving
 * it readable after one verification attempt invites replay.
 */
export async function consumeChallenge(
	env: Env,
	id: string,
	kind: "registration" | "authentication",
): Promise<string | null> {
	const db = getDb(env);
	const row = await db
		.select()
		.from(webauthnChallenges)
		.where(eq(webauthnChallenges.id, id))
		.get();

	await db.delete(webauthnChallenges).where(eq(webauthnChallenges.id, id));

	if (!row) return null;
	if (row.kind !== kind) return null;
	if (row.expiresAt <= Date.now()) return null;
	return row.challenge;
}

/** Housekeeping; also runs from the daily cron. */
export async function purgeExpiredChallenges(env: Env): Promise<void> {
	await getDb(env)
		.delete(webauthnChallenges)
		.where(lt(webauthnChallenges.expiresAt, Date.now()));
}

/** Credential ids and public keys are stored base64url; SimpleWebAuthn wants bytes. */
export function base64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
	const padded = value.replace(/-/g, "+").replace(/_/g, "/");
	const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
	const bytes = new Uint8Array(new ArrayBuffer(binary.length));
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

export function bytesToBase64url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
