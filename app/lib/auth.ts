import { redirect } from "react-router";
import type { User } from "~/db/schema";
import { getUser } from "./session";

/**
 * The one place that answers "who is this, and what may they see".
 *
 * `scope` exists from day one on purpose (PLAN.md §3): owners see every file, members see only
 * their own. Retrofitting that later is how you leak someone else's uploads.
 */
export interface AuthedUser {
	user: User;
	isOwner: boolean;
	/** null = no restriction (owner). Otherwise the only uploader id this user may see. */
	uploaderScope: string | null;
}

function toAuthed(user: User): AuthedUser {
	const isOwner = user.role === "owner";
	return { user, isOwner, uploaderScope: isOwner ? null : user.id };
}

/** Redirects to the landing page when signed out. Use in every /app loader and action. */
export async function requireUser(env: Env, request: Request): Promise<AuthedUser> {
	const user = await getUser(env, request);
	if (!user) throw redirect("/");
	return toAuthed(user);
}

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
