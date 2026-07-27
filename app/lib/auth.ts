import { redirect } from "react-router";
import type { User } from "~/db/schema";
import { getUser } from "./session";

/**
 * The one place that answers "who is this, and what may they see".
 *
 * Three roles:
 *   owner  — exactly one. Its role is immutable through the app, so there is always a account
 *            that cannot be demoted or removed by anyone.
 *   admin  — everything the owner can do, except changing the owner's role or removing them.
 *   member — uploads, and sees only their own files.
 *
 * `uploaderScope` exists from day one on purpose (PLAN.md §3): retrofitting it later is how
 * you leak someone else's uploads.
 */
export interface AuthedUser {
	user: User;
	isOwner: boolean;
	/** Owner or admin — the check almost every privileged route actually wants. */
	isAdmin: boolean;
	/** null = no restriction. Otherwise the only uploader id this user may see. */
	uploaderScope: string | null;
}

function toAuthed(user: User): AuthedUser {
	const isOwner = user.role === "owner";
	const isAdmin = isOwner || user.role === "admin";
	return { user, isOwner, isAdmin, uploaderScope: isAdmin ? null : user.id };
}

/** Redirects to the landing page when signed out. Use in every /app loader and action. */
export async function requireUser(env: Env, request: Request): Promise<AuthedUser> {
	const user = await getUser(env, request);
	if (!user) throw redirect("/");
	return toAuthed(user);
}

/**
 * Owner or admin. 404 rather than 403 for everyone else: a member has no business learning
 * that these routes exist.
 */
export async function requireAdmin(env: Env, request: Request): Promise<AuthedUser> {
	const authed = await requireUser(env, request);
	if (!authed.isAdmin) throw new Response("Not found", { status: 404 });
	return authed;
}

/** Strictly the owner. Reserved for things an admin must not be able to do. */
export async function requireOwner(env: Env, request: Request): Promise<AuthedUser> {
	const authed = await requireUser(env, request);
	if (!authed.isOwner) throw new Response("Not found", { status: 404 });
	return authed;
}

/** Non-redirecting variant, for routes that render differently when signed in. */
export async function getOptionalUser(
	env: Env,
	request: Request,
): Promise<AuthedUser | null> {
	const user = await getUser(env, request);
	return user ? toAuthed(user) : null;
}
