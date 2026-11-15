import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { cloudflareContext } from "~/context";
import { getRpConfig, storeChallenge } from "~/lib/webauthn";
import type { Route } from "./+types/auth.passkey.options";

/**
 * Begin passkey authentication.
 *
 * No `allowCredentials` and no email: passkeys are registered as discoverable (resident), so
 * the authenticator offers the right one and we learn who the user is from the assertion.
 * That also means this endpoint leaks nothing about which accounts exist.
 */
export async function action({ request, context }: Route.ActionArgs) {
	const env = context.get(cloudflareContext).env;
	const rp = getRpConfig(request);

	const options = await generateAuthenticationOptions({
		rpID: rp.rpID,
		userVerification: "preferred",
	});

	const challengeId = await storeChallenge(env, options.challenge, "authentication");
	return Response.json({ challengeId, options });
}
