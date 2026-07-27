import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { getDb } from "~/db";
import { credentials } from "~/db/schema";
import { createSession } from "~/lib/session";
import { base64urlToBytes, consumeChallenge, getRpConfig } from "~/lib/webauthn";
import type { Route } from "./+types/auth.passkey.verify";

/** Finish passkey authentication: verify the assertion, then mint a session. */
export async function action({ request, context }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const body = (await request.json()) as {
		challengeId?: string;
		response?: AuthenticationResponseJSON;
	};

	if (!body.challengeId || !body.response) {
		return Response.json({ error: "Missing challenge or response." }, { status: 400 });
	}

	const expectedChallenge = await consumeChallenge(
		env,
		body.challengeId,
		"authentication",
	);
	if (!expectedChallenge) {
		return Response.json({ error: "Challenge expired. Try again." }, { status: 400 });
	}

	const db = getDb(env);
	const stored = await db
		.select()
		.from(credentials)
		.where(eq(credentials.id, body.response.id))
		.get();

	// Same generic message whether the credential is unknown or the signature is bad — no
	// probing which passkeys this server knows about.
	const rejected = Response.json(
		{ error: "That passkey was not recognized." },
		{ status: 400 },
	);
	if (!stored) return rejected;

	const rp = getRpConfig(request);
	let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
	try {
		verification = await verifyAuthenticationResponse({
			response: body.response,
			expectedChallenge,
			expectedOrigin: rp.origin,
			expectedRPID: rp.rpID,
			credential: {
				id: stored.id,
				publicKey: base64urlToBytes(stored.publicKey),
				counter: stored.counter,
				transports: stored.transports ? JSON.parse(stored.transports) : undefined,
			},
			requireUserVerification: false,
		});
	} catch {
		return rejected;
	}

	if (!verification.verified) return rejected;

	// Bump the signature counter — a counter that goes backwards is the standard cloned-
	// authenticator signal. Passkeys synced across devices report 0 and are exempt.
	const { newCounter } = verification.authenticationInfo;
	if (stored.counter > 0 && newCounter <= stored.counter) {
		return Response.json(
			{ error: "That passkey looks cloned. Sign-in blocked." },
			{ status: 400 },
		);
	}

	await db
		.update(credentials)
		.set({ counter: newCounter, lastUsedAt: Date.now() })
		.where(eq(credentials.id, stored.id));

	const cookie = await createSession(env, stored.userId, request);
	return Response.json({ ok: true }, { headers: { "set-cookie": cookie } });
}
