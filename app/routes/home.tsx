import { eq } from "drizzle-orm";
import { useState } from "react";
import { redirect, useNavigate } from "react-router";
import { Signature, Wordmark } from "~/components/brand";
import { cloudflareContext } from "~/context";
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
	const env = context.get(cloudflareContext).env;
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
		<main className="flex min-h-dvh flex-col items-center px-4">
			<div className="flex w-full max-w-sm flex-1 flex-col justify-center py-16 text-center">
				<TossArc />
				<h1 className="mt-2">
					<Wordmark size="lg" />
				</h1>
				<p className="mt-4 text-balance font-display text-lg text-muted italic sm:text-xl">
					Toss a big file, get a link, send the link.
				</p>

				{!ownerExists ? (
					<p className="mt-10 rounded-2xl border border-line/70 bg-white/70 px-4 py-3 text-ink-soft text-sm shadow-soft">
						No owner yet. Run <code>bun run scripts/bootstrap-owner.ts</code>
					</p>
				) : (
					<button
						type="button"
						disabled={busy}
						onClick={() =>
							run(needsBootstrap ? () => registerPasskey() : signInWithPasskey)
						}
						className="mt-10 w-full rounded-full bg-signature px-5 py-3.5 font-medium text-white shadow-soft transition hover:shadow-lift hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{busy
							? "Waiting for your device…"
							: needsBootstrap
								? "Create your passkey"
								: "Sign in with passkey"}
					</button>
				)}

				{needsBootstrap && ownerExists && (
					<p className="mt-3 text-muted text-xs">
						First run — this sets up the owner passkey, then never appears again.
					</p>
				)}

				{error && (
					<p className="mt-4 text-rose-600 text-sm" role="alert">
						{error}
					</p>
				)}
			</div>
			<Signature />
		</main>
	);
}

/** The toss itself, drawn in the signature gradient: a dotted arc and the file in flight. */
function TossArc() {
	return (
		<svg
			viewBox="0 0 120 48"
			className="mx-auto h-12 w-30"
			fill="none"
			aria-hidden="true"
		>
			<defs>
				<linearGradient id="toss-arc" x1="0" x2="1">
					<stop offset="0" stopColor="var(--color-violet-400)" />
					<stop offset="1" stopColor="var(--color-rose-400)" />
				</linearGradient>
			</defs>
			<path
				d="M8 44C28 8 76 0 104 16"
				stroke="url(#toss-arc)"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeDasharray="2 5"
			/>
			<circle cx="106" cy="17" r="4.5" fill="var(--color-rose-400)" />
		</svg>
	);
}
