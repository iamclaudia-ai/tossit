import { and, eq, isNull } from "drizzle-orm";
import { createCookie } from "react-router";
import { getDb } from "~/db";
import { sessions, users } from "~/db/schema";
import { isSecureOrigin } from "./origin";
import { generateSessionId } from "./tokens";

/**
 * Sessions: a signed HTTP-only cookie carrying an opaque id that points at a `sessions` row.
 * The row is what makes a session revocable — clearing the cookie is not enough.
 */

const COOKIE_NAME = "__tossit_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Built per request: the signing secret lives in env (only available at request time on
 * Workers), and `secure` has to follow the origin the browser actually used. Hardcoding
 * secure=true silently drops the cookie on plain-http localhost; hardcoding false would ship
 * a non-secure session cookie to production.
 */
function sessionCookie(env: Env, request: Request) {
	return createCookie(COOKIE_NAME, {
		httpOnly: true,
		sameSite: "lax",
		path: "/",
		secure: isSecureOrigin(request),
		secrets: [env.SESSION_SECRET],
		maxAge: SESSION_TTL_MS / 1000,
	});
}

export async function createSession(
	env: Env,
	userId: string,
	request: Request,
): Promise<string> {
	const db = getDb(env);
	const id = generateSessionId();
	const now = Date.now();

	await db.insert(sessions).values({
		id,
		userId,
		userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
		createdAt: now,
		expiresAt: now + SESSION_TTL_MS,
	});

	return await sessionCookie(env, request).serialize(id);
}

/** The signed-in user, or null. Does not write on the read path. */
export async function getUser(env: Env, request: Request) {
	const sessionId = await sessionCookie(env, request).parse(
		request.headers.get("cookie"),
	);
	if (typeof sessionId !== "string" || !sessionId) return null;

	const db = getDb(env);
	const row = await db
		.select({ user: users, expiresAt: sessions.expiresAt })
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
		.get();

	if (!row || row.expiresAt <= Date.now()) return null;
	return row.user;
}

export async function destroySession(env: Env, request: Request): Promise<string> {
	const sessionId = await sessionCookie(env, request).parse(
		request.headers.get("cookie"),
	);
	if (typeof sessionId === "string" && sessionId) {
		await getDb(env)
			.update(sessions)
			.set({ revokedAt: Date.now() })
			.where(eq(sessions.id, sessionId));
	}
	return await sessionCookie(env, request).serialize("", { maxAge: 0 });
}
