import { startDeviceAuth } from "~/lib/device.server";
import { getRequestOrigin } from "~/lib/origin";
import type { Route } from "./+types/auth.device.start";

/**
 * Begins `tossit login`. Unauthenticated by design — this hands out nothing but a pending
 * request that is worthless until a signed-in human approves it in a browser.
 */
export async function action({ request, context }: Route.ActionArgs) {
	const env = context.cloudflare.env;

	let label: string | undefined;
	try {
		label = ((await request.json()) as { label?: string }).label;
	} catch {
		// Body is optional.
	}

	const started = await startDeviceAuth(env, label);
	return Response.json({
		deviceCode: started.deviceCode,
		userCode: started.userCode,
		verificationUri: `${getRequestOrigin(request)}/app/link`,
		expiresIn: started.expiresIn,
		interval: started.interval,
	});
}
