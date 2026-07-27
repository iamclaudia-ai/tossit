/**
 * Edge rate limiting for the public lookup paths.
 *
 * Slugs and invite codes are 128 bits, so guessing is already hopeless; this exists so that
 * *trying* costs something and can't be used to hammer the Worker. Deliberately not backed by
 * D1: a write per download request would be the most expensive thing in the app.
 */

interface RateLimiter {
	limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Best-effort client identity. CF-Connecting-IP is set by Cloudflare and not user-spoofable. */
export function clientKey(request: Request): string {
	return (
		request.headers.get("cf-connecting-ip") ??
		request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
		"unknown"
	);
}

/**
 * Returns a 429 response when the caller is over budget, or null to proceed.
 *
 * The binding is absent in local dev, where it simply allows everything — rate limiting is a
 * production concern and failing closed locally would just make development annoying.
 */
export async function checkRateLimit(
	limiter: RateLimiter | undefined,
	request: Request,
	scope: string,
): Promise<Response | null> {
	if (!limiter) return null;

	try {
		const { success } = await limiter.limit({ key: `${scope}:${clientKey(request)}` });
		if (success) return null;
	} catch {
		// Never let a limiter outage take the download path down with it.
		return null;
	}

	return new Response("Too many requests", {
		status: 429,
		headers: { "retry-after": "60", "cache-control": "no-store" },
	});
}

/** SHA-256 of the IP with the app secret as salt — enough to count uniques, never reversible. */
export async function hashIp(env: Env, request: Request): Promise<string | null> {
	const ip = request.headers.get("cf-connecting-ip");
	if (!ip) return null;

	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(`${ip}:${env.SESSION_SECRET}`),
	);
	// Truncated: this is for "how many distinct people", not forensics.
	return [...new Uint8Array(digest)]
		.slice(0, 12)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}
