import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
	return [
		{ title: "tossit.sh" },
		{
			name: "description",
			content: "Toss a big file, get a link, send the link.",
		},
	];
}

export default function Home() {
	return (
		<main className="flex min-h-dvh flex-col items-center justify-center px-6">
			<div className="w-full max-w-md text-center">
				<h1 className="font-semibold text-5xl tracking-tight">
					toss<span className="text-accent">it</span>
				</h1>
				<p className="mt-4 text-balance text-ink-400 text-lg">
					Toss a big file, get a link, send the link.
				</p>

				<button
					type="button"
					disabled
					className="mt-10 w-full rounded-xl bg-accent px-5 py-3 font-medium text-white transition hover:bg-accent-bright disabled:cursor-not-allowed disabled:opacity-40"
				>
					Sign in with passkey
				</button>
				<p className="mt-3 text-ink-700 text-xs">Coming in Phase 2.</p>
			</div>
		</main>
	);
}
