import { createRequestHandler } from "react-router";
import { runCleanup } from "~/lib/cleanup.server";

declare module "react-router" {
	export interface AppLoadContext {
		cloudflare: {
			env: Env;
			ctx: ExecutionContext;
		};
	}
}

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

export default {
	fetch(request, env, ctx) {
		return requestHandler(request, {
			cloudflare: { env, ctx },
		});
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
