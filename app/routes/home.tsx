import { eq } from "drizzle-orm";
import { useState } from "react";
import { redirect, useNavigate } from "react-router";
import { getDb } from "~/db";
import { credentials, users } from "~/db/schema";
import { getOptionalUser } from "~/lib/auth";
import { registerPasskey, signInWithPasskey } from "~/lib/passkey-client";
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

export async function loader({ request, context }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	if (await getOptionalUser(env, request)) throw redirect("/app");

	// The bootstrap window: the owner row exists but has no passkey yet, so the first visit
	// offers "create a passkey" instead of "sign in". It closes for good after that.
	const db = getDb(env);
	const owner = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.email, env.OWNER_EMAIL))
		.get();

	let needsBootstrap = false;
	if (owner) {
		const existing = await db
			.select({ id: credentials.id })
			.from(credentials)
			.where(eq(credentials.userId, owner.id))
			.get();
		needsBootstrap = !existing;
	}

	return { needsBootstrap, ownerExists: Boolean(owner) };
}

export default function Home({ loaderData }: Route.ComponentProps) {
	const { needsBootstrap, ownerExists } = loaderData;
	const navigate = useNavigate();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function run(action: () => Promise<void>) {
		setBusy(true);
		setError(null);
		try {
			await action();
			navigate("/app");
		} catch (cause) {
			const message = (cause as Error).message ?? "Something went wrong.";
			// The browser throws this when the user dismisses the system sheet.
			setError(/NotAllowed|abort/i.test(message) ? "Cancelled." : message);
			setBusy(false);
		}
	}

	return (
		<main className="flex min-h-dvh flex-col items-center justify-center px-6">
			<div className="w-full max-w-sm text-center">
				<h1 className="font-semibold text-5xl tracking-tight">
					toss<span className="text-accent">it</span>
				</h1>
				<p className="mt-4 text-balance text-ink-400 text-lg">
					Toss a big file, get a link, send the link.
				</p>

				{!ownerExists ? (
					<p className="mt-10 rounded-xl border border-ink-800 px-4 py-3 text-ink-400 text-sm">
						No owner yet. Run{" "}
						<code className="text-accent">bun run scripts/bootstrap-owner.ts</code>
					</p>
				) : (
					<button
						type="button"
						disabled={busy}
						onClick={() =>
							run(needsBootstrap ? () => registerPasskey() : signInWithPasskey)
						}
						className="mt-10 w-full rounded-xl bg-accent px-5 py-3 font-medium text-white transition hover:bg-accent-bright disabled:cursor-not-allowed disabled:opacity-40"
					>
						{busy
							? "Waiting for your device…"
							: needsBootstrap
								? "Create your passkey"
								: "Sign in with passkey"}
					</button>
				)}

				{needsBootstrap && ownerExists && (
					<p className="mt-3 text-ink-700 text-xs">
						First run — this sets up the owner passkey, then never appears again.
					</p>
				)}

				{error && (
					<p className="mt-4 text-rose-400 text-sm" role="alert">
						{error}
					</p>
				)}
			</div>
		</main>
	);
}
