import { redirect } from "react-router";
import { cloudflareContext } from "~/context";
import { destroySession } from "~/lib/session";
import type { Route } from "./+types/auth.signout";

export async function action({ request, context }: Route.ActionArgs) {
	const cookie = await destroySession(context.get(cloudflareContext).env, request);
	return redirect("/", { headers: { "set-cookie": cookie } });
}

/** Nothing to render; a GET here just bounces home. */
export function loader() {
	return redirect("/");
}
