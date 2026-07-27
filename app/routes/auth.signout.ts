import { redirect } from "react-router";
import { destroySession } from "~/lib/session";
import type { Route } from "./+types/auth.signout";

export async function action({ request, context }: Route.ActionArgs) {
	const cookie = await destroySession(context.cloudflare.env, request);
	return redirect("/", { headers: { "set-cookie": cookie } });
}

/** Nothing to render; a GET here just bounces home. */
export function loader() {
	return redirect("/");
}
