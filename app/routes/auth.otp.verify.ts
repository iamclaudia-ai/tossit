import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "~/db";
import { invites, users } from "~/db/schema";
import { resolveInvite } from "~/lib/invites.server";
import { looksLikeEmail, verifyOtp } from "~/lib/otp.server";
import { createSession } from "~/lib/session";
import type { Route } from "./+types/auth.otp.verify";

/**
 * Verifies the emailed code and turns the invite into a member account.
 *
 * A verified code mints a session immediately, which is what lets the browser then register a
 * passkey through the ordinary signed-in path. The session is the registration ticket — email
 * possession is the only thing it ever proves, and a passkey is still required to sign in
 * again once it lapses.
 */
export async function action({ request, context }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const body = (await request.json()) as {
		code?: string;
		email?: string;
		otp?: string;
	};

	const email = body.email?.trim().toLowerCase() ?? "";
	if (!looksLikeEmail(email) || !body.otp) {
		return Response.json({ error: "Enter the code from your email." }, { status: 400 });
	}

	const resolution = await resolveInvite(env, body.code ?? "");
	if (!resolution.ok || resolution.invite.kind !== "account") {
		return Response.json(
			{ error: "This invitation is no longer valid." },
			{ status: 404 },
		);
	}

	const { invite } = resolution;
	if (invite.email && invite.email.toLowerCase() !== email) {
		return Response.json(
			{ error: "This invitation is for a different email address." },
			{ status: 403 },
		);
	}

	const check = await verifyOtp(env, email, invite.id, body.otp);
	if (!check.ok) return Response.json({ error: check.error }, { status: 400 });

	const db = getDb(env);
	const now = Date.now();

	// Claiming an invite with an address that already has an account signs that account in
	// rather than creating a duplicate — emails are unique.
	let user = await db.select().from(users).where(eq(users.email, email)).get();
	if (!user) {
		const id = nanoid();
		await db.insert(users).values({
			id,
			email,
			name: null,
			role: "member",
			createdAt: now,
		});
		user = await db.select().from(users).where(eq(users.id, id)).get();
	}
	if (!user) {
		return Response.json({ error: "Could not create the account." }, { status: 500 });
	}

	await db
		.update(invites)
		.set({ claimedAt: now, claimedBy: user.id, uses: invite.uses + 1 })
		.where(eq(invites.id, invite.id));

	const cookie = await createSession(env, user.id, request);
	return Response.json(
		{ ok: true, email: user.email },
		{ headers: { "set-cookie": cookie } },
	);
}
