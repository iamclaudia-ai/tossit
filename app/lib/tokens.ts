/**
 * Public token generation — see PLAN.md §4.
 *
 * Everything reachable from a public URL (download slugs, invite codes) is 16 random bytes
 * base64url-encoded: 22 chars, 128 bits. Never sequential, never timestamped, never derived
 * from a filename.
 */

const PUBLIC_TOKEN_BYTES = 16;
const SESSION_ID_BYTES = 32;

function base64url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(byteLength: number): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return base64url(bytes);
}

/** 22-char, 128-bit download slug. */
export const generateSlug = () => randomToken(PUBLIC_TOKEN_BYTES);

/** 22-char, 128-bit invite code. Same generator, same strength. */
export const generateInviteCode = () => randomToken(PUBLIC_TOKEN_BYTES);

/** Opaque 32-byte session id. */
export const generateSessionId = () => randomToken(SESSION_ID_BYTES);

/** Opaque device token for the CLI. Only the SHA-256 is stored. */
export const generateDeviceToken = () => randomToken(SESSION_ID_BYTES);

export async function sha256(input: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
	return base64url(new Uint8Array(digest));
}

/**
 * Constant-time string comparison. Used for invite codes and OTPs so that a timing side
 * channel can't be used to walk a secret one character at a time.
 */
export function timingSafeEqual(a: string, b: string): boolean {
	const aBytes = new TextEncoder().encode(a);
	const bBytes = new TextEncoder().encode(b);
	// Length is not secret, but bail without an early-exit comparison on contents.
	if (aBytes.length !== bBytes.length) return false;
	let diff = 0;
	for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
	return diff === 0;
}

/** 6-digit numeric OTP, uniformly distributed (no modulo bias). */
export function generateOtp(): string {
	const bytes = new Uint32Array(1);
	let value: number;
	do {
		crypto.getRandomValues(bytes);
		value = bytes[0];
	} while (value >= 4_294_000_000); // largest multiple of 1e6 below 2^32
	return String(value % 1_000_000).padStart(6, "0");
}
