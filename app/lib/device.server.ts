import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "~/db";
import { deviceAuthorizations, deviceTokens, users } from "~/db/schema";
import { generateDeviceToken, sha256, timingSafeEqual } from "./tokens";

/**
 * Headless auth for the `tossit` CLI — the OAuth device-authorization grant.
 *
 * The CLI never handles a password and never asks the user to paste a secret: it shows a short
 * code, the user approves it in a browser where they're already signed in with a passkey, and
 * the CLI collects a token.
 */

const AUTH_TTL_MS = 10 * 60 * 1000;
/** Poll interval the CLI is told to honour. */
export const POLL_INTERVAL_SECONDS = 2;

/**
 * Deliberately excludes I/1/O/0 — this gets read off a screen and typed by a human, and
 * ambiguity there is a support problem, not a security one.
 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function userCode(): string {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
	return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

export interface DeviceStart {
	deviceCode: string;
	userCode: string;
	expiresIn: number;
	interval: number;
}

export async function startDeviceAuth(env: Env, label?: string): Promise<DeviceStart> {
	const db = getDb(env);
	const deviceCode = generateDeviceToken();
	const code = userCode();

	await db.insert(deviceAuthorizations).values({
		id: nanoid(),
		deviceCodeHash: await sha256(deviceCode),
		userCode: code,
		label: label?.slice(0, 80) ?? null,
		expiresAt: Date.now() + AUTH_TTL_MS,
	});

	return {
		deviceCode,
		userCode: code,
		expiresIn: Math.floor(AUTH_TTL_MS / 1000),
		interval: POLL_INTERVAL_SECONDS,
	};
}

/** Finds a pending request by the code the human typed. */
export async function findPendingAuth(env: Env, code: string) {
	const normalized = normalizeUserCode(code);
	if (!normalized) return null;

	return (
		(await getDb(env)
			.select()
			.from(deviceAuthorizations)
			.where(
				and(
					eq(deviceAuthorizations.userCode, normalized),
					isNull(deviceAuthorizations.approvedAt),
					gt(deviceAuthorizations.expiresAt, Date.now()),
				),
			)
			.get()) ?? null
	);
}

/** Mints the token and parks it for collection. Called only from an authenticated browser. */
export async function approveDeviceAuth(
	env: Env,
	authId: string,
	userId: string,
	label: string | null,
): Promise<void> {
	const db = getDb(env);
	const token = generateDeviceToken();
	const now = Date.now();

	await db.insert(deviceTokens).values({
		id: nanoid(),
		tokenHash: await sha256(token),
		userId,
		label: label?.slice(0, 80) ?? "CLI",
		createdAt: now,
		expiresAt: null,
	});

	await db
		.update(deviceAuthorizations)
		.set({ approvedAt: now, approvedBy: userId, tokenPlain: token })
		.where(eq(deviceAuthorizations.id, authId));
}

export type PollResult =
	| { status: "pending" }
	| { status: "expired" }
	| { status: "ready"; token: string };

export async function pollDeviceAuth(env: Env, deviceCode: string): Promise<PollResult> {
	const db = getDb(env);
	const hash = await sha256(deviceCode);

	const auth = await db
		.select()
		.from(deviceAuthorizations)
		.where(eq(deviceAuthorizations.deviceCodeHash, hash))
		.get();

	// Same answer for "never existed" and "expired": a poller learns nothing by guessing.
	if (!auth || !timingSafeEqual(auth.deviceCodeHash, hash)) return { status: "expired" };
	if (auth.expiresAt <= Date.now()) return { status: "expired" };
	if (!auth.approvedAt || !auth.tokenPlain) return { status: "pending" };

	// Collected exactly once — the plaintext must not outlive this call.
	await db.delete(deviceAuthorizations).where(eq(deviceAuthorizations.id, auth.id));
	return { status: "ready", token: auth.tokenPlain };
}

/** Resolves `Authorization: Bearer <token>` to a user, or null. */
export async function userFromBearer(env: Env, request: Request) {
	const header = request.headers.get("authorization");
	if (!header?.startsWith("Bearer ")) return null;

	const token = header.slice(7).trim();
	if (!token) return null;

	const db = getDb(env);
	const row = await db
		.select({ user: users, tokenId: deviceTokens.id, expiresAt: deviceTokens.expiresAt })
		.from(deviceTokens)
		.innerJoin(users, eq(deviceTokens.userId, users.id))
		.where(
			and(
				eq(deviceTokens.tokenHash, await sha256(token)),
				isNull(deviceTokens.revokedAt),
			),
		)
		.get();

	if (!row) return null;
	if (row.expiresAt !== null && row.expiresAt <= Date.now()) return null;

	// Best-effort; a failed timestamp update must not fail the request.
	await db
		.update(deviceTokens)
		.set({ lastUsedAt: Date.now() })
		.where(eq(deviceTokens.id, row.tokenId))
		.catch(() => {});

	return row.user;
}

export function normalizeUserCode(input: string): string | null {
	const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
	if (cleaned.length !== 8) return null;
	return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}

/** Housekeeping for the cron: drop stale requests, including uncollected tokens. */
export async function purgeExpiredDeviceAuths(env: Env): Promise<number> {
	const result = await getDb(env)
		.delete(deviceAuthorizations)
		.where(lt(deviceAuthorizations.expiresAt, Date.now()));
	return result.meta?.changes ?? 0;
}
