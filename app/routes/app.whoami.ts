import { requireUser } from "~/lib/auth";
import type { Route } from "./+types/app.whoami";

/** Identity check for the CLI — also how `tossit login` confirms a fresh token works. */
export async function loader({ request, context }: Route.LoaderArgs) {
	const { user } = await requireUser(context.cloudflare.env, request);
	return Response.json({ email: user.email, role: user.role, id: user.id });
}
