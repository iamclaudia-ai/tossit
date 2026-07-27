import { otpEmail, sendEmail } from "~/lib/email.server";
import { resolveInvite } from "~/lib/invites.server";
import { issueOtp, looksLikeEmail } from "~/lib/otp.server";
import type { Route } from "./+types/auth.otp.request";

/** Sends a verification code for an account invite. */
export async function action({ request, context }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const body = (await request.json()) as { code?: string; email?: string };

	const email = body.email?.trim().toLowerCase() ?? "";
	if (!looksLikeEmail(email)) {
		return Response.json(
			{ error: "That doesn't look like an email address." },
			{ status: 400 },
		);
	}

	const resolution = await resolveInvite(env, body.code ?? "");
	if (!resolution.ok || resolution.invite.kind !== "account") {
		return Response.json(
			{ error: "This invitation is no longer valid." },
			{ status: 404 },
		);
	}

	const { invite } = resolution;

	// An invite addressed to a specific person can only be claimed by that person.
	if (invite.email && invite.email.toLowerCase() !== email) {
		return Response.json(
			{ error: "This invitation is for a different email address." },
			{ status: 403 },
		);
	}

	const issued = await issueOtp(env, email, invite.id);
	if (!issued.ok) return Response.json({ error: issued.error }, { status: 429 });

	try {
		await sendEmail(env, { to: email, ...otpEmail(issued.code, invite.label) });
	} catch (error) {
		// Log the provider's reason; never echo it back, since it can contain the address.
		console.error("OTP send failed:", (error as Error).message);
		return Response.json(
			{ error: "Couldn't send the code. Try again in a moment." },
			{ status: 502 },
		);
	}

	return Response.json({ ok: true });
}
