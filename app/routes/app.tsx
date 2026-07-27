import { Form } from "react-router";
import { requireUser } from "~/lib/auth";
import type { Route } from "./+types/app";

export function meta(_: Route.MetaArgs) {
	return [{ title: "tossit" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const { user, isOwner } = await requireUser(context.cloudflare.env, request);
	return { email: user.email, isOwner };
}

export default function App({ loaderData }: Route.ComponentProps) {
	return (
		<div className="min-h-dvh">
			<header className="flex items-center justify-between border-ink-800 border-b px-6 py-4">
				<span className="font-semibold text-lg tracking-tight">
					toss<span className="text-accent">it</span>
				</span>
				<div className="flex items-center gap-4 text-sm">
					<span className="text-ink-400">{loaderData.email}</span>
					<Form method="post" action="/auth/signout">
						<button
							type="submit"
							className="rounded-lg px-3 py-1.5 text-ink-400 transition hover:bg-ink-900 hover:text-ink-200"
						>
							Sign out
						</button>
					</Form>
				</div>
			</header>

			<main className="flex min-h-[70dvh] flex-col items-center justify-center px-6 text-center">
				<div className="w-full max-w-lg rounded-2xl border border-ink-800 border-dashed px-8 py-16">
					<p className="text-ink-400">The dropzone lands in Phase 3.</p>
					<p className="mt-2 text-ink-700 text-sm">
						Auth works — you are signed in with a passkey.
					</p>
				</div>
			</main>
		</div>
	);
}
