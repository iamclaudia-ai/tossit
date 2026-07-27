import { and, desc, eq, isNull } from "drizzle-orm";
import { useState } from "react";
import { data, Link, useFetcher, useRevalidator } from "react-router";
import { getDb } from "~/db";
import { credentials, deviceTokens, sessions } from "~/db/schema";
import { requireUser } from "~/lib/auth";
import { runCleanup } from "~/lib/cleanup.server";
import { formatAge } from "~/lib/format";
import { registerPasskey } from "~/lib/passkey-client";
import type { Route } from "./+types/app.settings";

export function meta() {
	return [{ title: "Settings — tossit" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const { user } = await requireUser(env, request);
	const db = getDb(env);

	const [keys, active, tokens] = await Promise.all([
		db
			.select()
			.from(credentials)
			.where(eq(credentials.userId, user.id))
			.orderBy(desc(credentials.createdAt))
			.all(),
		db
			.select()
			.from(sessions)
			.where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)))
			.orderBy(desc(sessions.createdAt))
			.all(),
		db
			.select()
			.from(deviceTokens)
			.where(and(eq(deviceTokens.userId, user.id), isNull(deviceTokens.revokedAt)))
			.orderBy(desc(deviceTokens.createdAt))
			.all(),
	]);

	const now = Date.now();
	return {
		email: user.email,
		passkeys: keys.map((key) => ({
			id: key.id,
			nickname: key.nickname,
			createdAt: key.createdAt,
			lastUsedAt: key.lastUsedAt,
			backedUp: key.backedUp,
		})),
		sessions: active
			.filter((session) => session.expiresAt > now)
			.map((session) => ({
				id: session.id,
				userAgent: session.userAgent,
				createdAt: session.createdAt,
				expiresAt: session.expiresAt,
			})),
		deviceTokens: tokens.map((token) => ({
			id: token.id,
			label: token.label,
			createdAt: token.createdAt,
			lastUsedAt: token.lastUsedAt,
		})),
	};
}

export async function action({ request, context }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const { user, isAdmin } = await requireUser(env, request);
	const db = getDb(env);

	const form = await request.formData();
	const intent = form.get("intent");

	if (intent === "delete-passkey") {
		const id = String(form.get("id") ?? "");
		const mine = await db
			.select()
			.from(credentials)
			.where(and(eq(credentials.id, id), eq(credentials.userId, user.id)))
			.all();
		if (!mine.length)
			return data({ ok: false, error: "Not found.", report: null }, { status: 404 });

		const remaining = await db
			.select({ id: credentials.id })
			.from(credentials)
			.where(eq(credentials.userId, user.id))
			.all();

		// Removing the last passkey would lock the account out permanently — there is no
		// password to fall back on and no recovery flow by design.
		if (remaining.length <= 1) {
			return data(
				{
					ok: false,
					error: "That's your only passkey. Add another before removing this one.",
					report: null,
				},
				{ status: 400 },
			);
		}

		await db.delete(credentials).where(eq(credentials.id, id));
		return { ok: true, error: null, report: null };
	}

	if (intent === "run-cleanup") {
		// The same job the daily cron runs. Exposed so housekeeping can be triggered and
		// inspected on demand rather than only observed after the fact in logs.
		if (!isAdmin)
			return data({ ok: false, error: "Not found.", report: null }, { status: 404 });
		const report = await runCleanup(env);
		return { ok: true, error: null, report };
	}

	if (intent === "revoke-token") {
		const id = String(form.get("id") ?? "");
		await db
			.update(deviceTokens)
			.set({ revokedAt: Date.now() })
			.where(and(eq(deviceTokens.id, id), eq(deviceTokens.userId, user.id)));
		return { ok: true, error: null, report: null };
	}

	if (intent === "revoke-session") {
		const id = String(form.get("id") ?? "");
		await db
			.update(sessions)
			.set({ revokedAt: Date.now() })
			.where(and(eq(sessions.id, id), eq(sessions.userId, user.id)));
		return { ok: true, error: null, report: null };
	}

	return data({ ok: false, error: "Unknown action.", report: null }, { status: 400 });
}

export default function Settings({ loaderData, actionData }: Route.ComponentProps) {
	const revalidator = useRevalidator();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	return (
		<div className="min-h-dvh">
			<header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
				<Link to="/app" className="font-semibold text-lg tracking-tight">
					toss<span className="text-accent">it</span>
				</Link>
				<Link
					to="/app"
					className="rounded-lg px-3 py-1.5 text-ink-400 text-sm transition hover:bg-ink-900 hover:text-ink-200"
				>
					Back to files
				</Link>
			</header>

			<main className="mx-auto max-w-3xl px-6 pb-24">
				<h1 className="font-medium text-2xl tracking-tight">Settings</h1>
				<p className="mt-1 text-ink-500 text-sm">{loaderData.email}</p>

				<section className="mt-8">
					<div className="flex items-end justify-between">
						<div>
							<h2 className="font-medium">Passkeys</h2>
							<p className="mt-0.5 text-ink-500 text-sm">
								Add one per device. There is no password to fall back on.
							</p>
						</div>
						<button
							type="button"
							disabled={busy}
							onClick={async () => {
								setBusy(true);
								setError(null);
								try {
									await registerPasskey();
									revalidator.revalidate();
								} catch (cause) {
									const message = (cause as Error).message ?? "Failed.";
									setError(/NotAllowed|abort/i.test(message) ? "Cancelled." : message);
								} finally {
									setBusy(false);
								}
							}}
							className="rounded-lg bg-accent px-3 py-1.5 font-medium text-sm text-white transition hover:bg-accent-bright disabled:opacity-50"
						>
							{busy ? "Waiting…" : "Add passkey"}
						</button>
					</div>

					{error && <p className="mt-3 text-rose-400 text-sm">{error}</p>}
					{actionData?.error && (
						<p className="mt-3 text-rose-400 text-sm">{actionData.error}</p>
					)}

					<ul className="mt-4 divide-y divide-ink-900 overflow-hidden rounded-2xl border border-ink-900">
						{loaderData.passkeys.map((key) => (
							<li
								key={key.id}
								className="flex items-center gap-3 bg-ink-900/40 px-4 py-3"
							>
								<div className="min-w-0 flex-1">
									<p className="truncate font-medium text-sm">
										{key.nickname ?? "Passkey"}
										{key.backedUp && (
											<span className="ml-2 rounded bg-ink-850 px-1.5 py-0.5 font-normal text-ink-400 text-xs">
												synced
											</span>
										)}
									</p>
									<p className="tnum mt-0.5 font-mono text-ink-500 text-xs">
										added {formatAge(key.createdAt)}
										{key.lastUsedAt && ` · last used ${formatAge(key.lastUsedAt)}`}
									</p>
								</div>
								<RowAction
									intent="delete-passkey"
									id={key.id}
									label="Remove"
									confirm="Remove this passkey?"
								/>
							</li>
						))}
					</ul>
				</section>

				<section className="mt-10">
					<h2 className="font-medium">Active sessions</h2>
					<p className="mt-0.5 text-ink-500 text-sm">
						Revoking a session signs that browser out immediately.
					</p>

					<ul className="mt-4 divide-y divide-ink-900 overflow-hidden rounded-2xl border border-ink-900">
						{loaderData.sessions.map((session) => (
							<li
								key={session.id}
								className="flex items-center gap-3 bg-ink-900/40 px-4 py-3"
							>
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm">{describeAgent(session.userAgent)}</p>
									<p className="tnum mt-0.5 font-mono text-ink-500 text-xs">
										started {formatAge(session.createdAt)}
									</p>
								</div>
								<RowAction
									intent="revoke-session"
									id={session.id}
									label="Revoke"
									confirm="Sign this session out?"
								/>
							</li>
						))}
					</ul>
				</section>

				<section className="mt-10">
					<h2 className="font-medium">Command line</h2>
					<p className="mt-0.5 text-ink-500 text-sm">
						Terminals linked with <code className="text-ink-400">tossit login</code>.
						Revoking one signs that machine out immediately.
					</p>

					{loaderData.deviceTokens.length === 0 ? (
						<div className="mt-4 rounded-2xl border border-ink-900 border-dashed px-4 py-6 text-center">
							<p className="text-ink-500 text-sm">No terminals linked yet.</p>
							<p className="mt-1 font-mono text-ink-700 text-xs">
								npx @iamclaudia/tossit login
							</p>
						</div>
					) : (
						<ul className="mt-4 divide-y divide-ink-900 overflow-hidden rounded-2xl border border-ink-900">
							{loaderData.deviceTokens.map((token) => (
								<li
									key={token.id}
									className="flex items-center gap-3 bg-ink-900/40 px-4 py-3"
								>
									<div className="min-w-0 flex-1">
										<p className="truncate font-medium text-sm">
											{token.label ?? "Terminal"}
										</p>
										<p className="tnum mt-0.5 font-mono text-ink-500 text-xs">
											linked {formatAge(token.createdAt)}
											{token.lastUsedAt
												? ` · last used ${formatAge(token.lastUsedAt)}`
												: " · never used"}
										</p>
									</div>
									<RowAction
										intent="revoke-token"
										id={token.id}
										label="Revoke"
										confirm="Revoke this terminal?"
									/>
								</li>
							))}
						</ul>
					)}
				</section>

				<section className="mt-10">
					<h2 className="font-medium">Maintenance</h2>
					<p className="mt-0.5 text-ink-500 text-sm">
						Runs nightly on its own. This is the same job, on demand.
					</p>
					<CleanupButton />
				</section>
			</main>
		</div>
	);
}

/** The daily cron, triggerable by hand — useful for confirming it actually does something. */
function CleanupButton() {
	const fetcher = useFetcher<{ report?: Record<string, number | string[]> | null }>();
	const report = fetcher.data?.report;

	return (
		<div className="mt-4 rounded-2xl border border-ink-900 bg-ink-900/40 px-4 py-3">
			<div className="flex items-center gap-3">
				<p className="flex-1 text-ink-400 text-sm">
					Purge expired files, abandoned uploads, and dead sessions.
				</p>
				<button
					type="button"
					disabled={fetcher.state !== "idle"}
					onClick={() =>
						fetcher.submit(
							{ intent: "run-cleanup" },
							{ method: "post", action: "/app/settings" },
						)
					}
					className="rounded-lg bg-ink-850 px-3 py-1.5 font-medium text-sm transition hover:bg-ink-800 disabled:opacity-50"
				>
					{fetcher.state !== "idle" ? "Running…" : "Run now"}
				</button>
			</div>

			{report && (
				<p className="tnum mt-3 font-mono text-ink-500 text-xs">
					{Object.entries(report)
						.filter(([key]) => key !== "errors")
						.map(([key, value]) => `${key}: ${value}`)
						.join(" · ")}
				</p>
			)}
		</div>
	);
}

function RowAction({
	intent,
	id,
	label,
	confirm,
}: {
	intent: string;
	id: string;
	label: string;
	confirm: string;
}) {
	const fetcher = useFetcher();
	const [confirming, setConfirming] = useState(false);

	if (fetcher.state !== "idle") {
		return <span className="text-ink-500 text-sm">Working…</span>;
	}

	if (!confirming) {
		return (
			<button
				type="button"
				onClick={() => setConfirming(true)}
				className="rounded-lg px-3 py-1.5 text-ink-500 text-sm transition hover:bg-rose-500/10 hover:text-rose-400"
			>
				{label}
			</button>
		);
	}

	return (
		<div className="flex items-center gap-2">
			<span className="text-ink-400 text-xs">{confirm}</span>
			<button
				type="button"
				onClick={() => setConfirming(false)}
				className="rounded-lg px-2 py-1 text-ink-500 text-sm hover:text-ink-200"
			>
				No
			</button>
			<button
				type="button"
				onClick={() =>
					fetcher.submit({ intent, id }, { method: "post", action: "/app/settings" })
				}
				className="rounded-lg bg-rose-500/90 px-3 py-1.5 font-medium text-sm text-white transition hover:bg-rose-500"
			>
				{label}
			</button>
		</div>
	);
}

/** Just enough of the user agent to recognise your own devices. */
function describeAgent(agent: string | null): string {
	if (!agent) return "Unknown device";
	if (/iPhone/.test(agent)) return "iPhone";
	if (/iPad/.test(agent)) return "iPad";
	if (/Android/.test(agent)) return "Android";
	const browser = /Firefox/.test(agent)
		? "Firefox"
		: /Edg\//.test(agent)
			? "Edge"
			: /Chrome/.test(agent)
				? "Chrome"
				: /Safari/.test(agent)
					? "Safari"
					: "Browser";
	const os = /Mac OS X/.test(agent)
		? "macOS"
		: /Windows/.test(agent)
			? "Windows"
			: /Linux/.test(agent)
				? "Linux"
				: "";
	return os ? `${browser} on ${os}` : browser;
}
