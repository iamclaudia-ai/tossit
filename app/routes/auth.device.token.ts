import { pollDeviceAuth } from "~/lib/device.server";
import type { Route } from "./+types/auth.device.token";

/** The CLI polls here until the request is approved, expires, or is denied. */
export async function action({ request, context }: Route.ActionArgs) {
	const env = context.cloudflare.env;

	const body = (await request.json().catch(() => ({}))) as { deviceCode?: string };
	if (!body.deviceCode) {
		return Response.json({ error: "deviceCode is required." }, { status: 400 });
	}

	const result = await pollDeviceAuth(env, body.deviceCode);

	if (result.status === "pending") {
		// 202: the request is valid and simply hasn't been approved yet.
		return Response.json({ status: "pending" }, { status: 202 });
	}
	if (result.status === "expired") {
		return Response.json({ status: "expired" }, { status: 410 });
	}

	return Response.json({ status: "ready", token: result.token });
}
