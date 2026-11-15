import { createRequestHandler, RouterContextProvider } from "react-router";
import { cloudflareContext } from "~/context";
import { runCleanup } from "~/lib/cleanup.server";

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

export default {
	fetch(request, env, ctx) {
		const context = new RouterContextProvider();
		context.set(cloudflareContext, { env, ctx });
		return requestHandler(request, context);
	},

	/**
	 * Daily housekeeping. Logged rather than silent: this is the only thing that
	 * reclaims storage from expired files and abandoned multipart uploads, and a cron that
	 * quietly fails would show up as a bill rather than an error.
	 */
	async scheduled(_controller, env, ctx) {
		ctx.waitUntil(
			runCleanup(env)
				.then((report) => {
					console.log("cleanup:", JSON.stringify(report));
					if (report.errors.length) {
						console.error("cleanup errors:", report.errors.join("; "));
					}
				})
				.catch((error) => console.error("cleanup failed:", (error as Error).message)),
		);
	},
} satisfies ExportedHandler<Env>;
