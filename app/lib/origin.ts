/**
 * The origin the *browser* saw — which is not always the one the Worker sees.
 *
 * Behind a TLS-terminating reverse proxy (Caddy in front of local dev, for example) the
 * inbound request arrives as plain http, so `new URL(request.url).origin` yields
 * `http://local.tossit.sh` while the browser reported `https://local.tossit.sh`. WebAuthn
 * compares origins exactly, so that mismatch fails every registration and assertion.
 */

export function getRequestOrigin(request: Request): string {
	const url = new URL(request.url);

	// Only the scheme is taken from the proxy header. The host stays whatever actually
	// addressed this Worker: host determines the WebAuthn rpID, and trusting a client-supplied
	// X-Forwarded-Host would let a caller nominate the relying party. Spoofing the scheme
	// alone can only make verification fail, never wrongly succeed.
	const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();

	const protocol =
		forwardedProto === "https" || forwardedProto === "http"
			? forwardedProto
			: url.protocol.replace(":", "");

	return `${protocol}://${url.host}`;
}

export function isSecureOrigin(request: Request): boolean {
	return getRequestOrigin(request).startsWith("https://");
}
