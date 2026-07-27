import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import {
	generateRegistrationOptions,
	verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { getDb } from "~/db";
import { credentials, users } from "~/db/schema";
import { getOptionalUser } from "~/lib/auth";
import { createSession } from "~/lib/session";
import {
	bytesToBase64url,
	consumeChallenge,
	getRpConfig,
	storeChallenge,
} from "~/lib/webauthn";
import type { Route } from "./+types/auth.passkey.register";

/**
 * Passkey registration — begin (`intent: "options"`) and finish (`intent: "verify"`).
 *
 * Who is allowed to register:
 *   - a signed-in user adding another device
 *   - the bootstrap case: the OWNER_EMAIL user exists but has no passkeys yet. That window
 *     closes permanently the moment the first credential is stored.
 */

interface Registrant {
	id: string;
	email: string;
	name: string | null;
	isBootstrap: boolean;
}

async function resolveRegistrant(env: Env, request: Request): Promise<Registrant | null> {
	const authed = await getOptionalUser(env, request);
	if (authed) {
		return {
			id: authed.user.id,
			email: authed.user.email,
			name: authed.user.name,
			isBootstrap: false,
		};
	}

	const db = getDb(env);
	const owner = await db
		.select()
		.from(users)
		.where(eq(users.email, env.OWNER_EMAIL))
		.get();
	if (!owner) return null;

	const existing = await db
		.select({ id: credentials.id })
		.from(credentials)
		.where(eq(credentials.userId, owner.id))
		.get();
	if (existing) return null; // bootstrap window is closed

	return {
		id: owner.id,
		email: owner.email,
		name: owner.name,
		isBootstrap: true,
	};
}

export async function action({ request, context }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const body = (await request.json()) as {
		intent: "options" | "verify";
		challengeId?: string;
		response?: RegistrationResponseJSON;
		nickname?: string;
	};

	const registrant = await resolveRegistrant(env, request);
	if (!registrant) {
		return Response.json({ error: "Registration is not open." }, { status: 403 });
	}

	const rp = getRpConfig(request);
	const db = getDb(env);

	if (body.intent === "options") {
		const existing = await db
			.select({ id: credentials.id, transports: credentials.transports })
			.from(credentials)
			.where(eq(credentials.userId, registrant.id))
			.all();

		const options = await generateRegistrationOptions({
			rpName: rp.rpName,
			rpID: rp.rpID,
			userID: new TextEncoder().encode(registrant.id),
			userName: registrant.email,
			userDisplayName: registrant.name ?? registrant.email,
			attestationType: "none",
			// Don't offer to re-register a passkey this account already has.
			excludeCredentials: existing.map((cred) => ({
				id: cred.id,
				transports: cred.transports ? JSON.parse(cred.transports) : undefined,
			})),
			authenticatorSelection: {
				residentKey: "required", // discoverable, so sign-in needs no email first
				userVerification: "preferred",
			},
		});

		const challengeId = await storeChallenge(
			env,
			options.challenge,
			"registration",
			registrant.email,
		);
		return Response.json({ challengeId, options });
	}

	if (body.intent === "verify") {
		if (!body.challengeId || !body.response) {
			return Response.json({ error: "Missing challenge or response." }, { status: 400 });
		}

		const expectedChallenge = await consumeChallenge(
			env,
			body.challengeId,
			"registration",
		);
		if (!expectedChallenge) {
			return Response.json({ error: "Challenge expired. Try again." }, { status: 400 });
		}

		let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
		try {
			verification = await verifyRegistrationResponse({
				response: body.response,
				expectedChallenge,
				expectedOrigin: rp.origin,
				expectedRPID: rp.rpID,
				requireUserVerification: false,
			});
		} catch (error) {
			return Response.json({ error: (error as Error).message }, { status: 400 });
		}

		if (!verification.verified || !verification.registrationInfo) {
			return Response.json({ error: "Could not verify that passkey." }, { status: 400 });
		}

		const { credential, credentialDeviceType, credentialBackedUp } =
			verification.registrationInfo;

		await db.insert(credentials).values({
			id: credential.id,
			userId: registrant.id,
			publicKey: bytesToBase64url(credential.publicKey),
			counter: credential.counter,
			transports: credential.transports ? JSON.stringify(credential.transports) : null,
			deviceType: credentialDeviceType,
			backedUp: credentialBackedUp,
			nickname: body.nickname?.slice(0, 80) ?? null,
			createdAt: Date.now(),
		});

		// Registering the very first passkey signs the owner straight in.
		const headers = new Headers();
		if (registrant.isBootstrap) {
			headers.append("set-cookie", await createSession(env, registrant.id, request));
		}
		return Response.json({ ok: true }, { headers });
	}

	return Response.json({ error: "Unknown intent." }, { status: 400 });
}
