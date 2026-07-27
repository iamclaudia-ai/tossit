import type {
	PublicKeyCredentialCreationOptionsJSON,
	PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

/** Browser half of the passkey dance. Both calls are two round trips: options, then verify. */

async function postJson(url: string, body: unknown) {
	const response = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	const data = (await response.json()) as Record<string, unknown>;
	if (!response.ok) {
		throw new Error((data.error as string) ?? "Something went wrong.");
	}
	return data;
}

export async function signInWithPasskey(): Promise<void> {
	const { challengeId, options } = (await postJson("/auth/passkey/options", {})) as {
		challengeId: string;
		options: PublicKeyCredentialRequestOptionsJSON;
	};
	const response = await startAuthentication({ optionsJSON: options });
	await postJson("/auth/passkey/verify", { challengeId, response });
}

export async function registerPasskey(nickname?: string): Promise<void> {
	const { challengeId, options } = (await postJson("/auth/passkey/register", {
		intent: "options",
	})) as { challengeId: string; options: PublicKeyCredentialCreationOptionsJSON };
	const response = await startRegistration({ optionsJSON: options });
	await postJson("/auth/passkey/register", {
		intent: "verify",
		challengeId,
		response,
		nickname: nickname ?? guessDeviceName(),
	});
}

/** Best-effort label so the passkey list in settings is readable later. */
function guessDeviceName(): string {
	const ua = navigator.userAgent;
	if (/iPhone/.test(ua)) return "iPhone";
	if (/iPad/.test(ua)) return "iPad";
	if (/Android/.test(ua)) return "Android";
	if (/Mac OS X/.test(ua)) return "Mac";
	if (/Windows/.test(ua)) return "Windows";
	return "Passkey";
}
