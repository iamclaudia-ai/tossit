import { data, Form, Link, useSearchParams } from "react-router";
import { requireUser } from "~/lib/auth";
import { approveDeviceAuth, findPendingAuth } from "~/lib/device.server";
import type { Route } from "./+types/app.link";

export function meta() {
	return [{ title: "Link a device — tossit" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	// Approving a device requires a real, passkey-backed session — never a device token.
	await requireUser(context.cloudflare.env, request);
	return null;
}

export async function action({ request, context }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const { user } = await requireUser(env, request);

	const form = await request.formData();
	const code = String(form.get("code") ?? "");

	const pending = await findPendingAuth(env, code);
	if (!pending) {
		return data(
			{
				ok: false,
				error: "That code isn't valid, or it has expired. Run `tossit login` again.",
			},
			{ status: 400 },
		);
	}

	await approveDeviceAuth(env, pending.id, user.id, pending.label);
	return { ok: true, error: null };
}

export default function LinkDevice({ actionData }: Route.ComponentProps) {
	const [params] = useSearchParams();

	if (actionData?.ok) {
		return (
			<Shell>
				<div className="text-center">
					<div className="mx-auto flex size-11 items-center justify-center rounded-full bg-accent/15">
						<svg
							width="22"
							height="22"
							viewBox="0 0 24 24"
							fill="none"
							aria-hidden="true"
						>
							<title>Linked</title>
							<path
								d="m5 12.5 4.5 4.5L19 7.5"
								stroke="oklch(0.76 0.17 300)"
								strokeWidth="2.2"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
					</div>
					<h1 className="mt-4 font-medium text-lg">Device linked</h1>
					<p className="mt-1 text-ink-500 text-sm">
						Your terminal is signed in. You can close this tab.
					</p>
					<Link
						to="/app/settings"
						className="mt-6 inline-block text-accent text-sm hover:text-accent-bright"
					>
						Manage device tokens
					</Link>
				</div>
			</Shell>
		);
	}

	return (
		<Shell>
			<h1 className="font-medium text-lg tracking-tight">Link a device</h1>
			<p className="mt-1 text-ink-500 text-sm">Enter the code shown in your terminal.</p>

			<Form method="post" className="mt-6">
				<input
					name="code"
					// Prefilled when the CLI could open the browser for you.
					defaultValue={params.get("code") ?? ""}
					// biome-ignore lint/a11y/noAutofocus: you arrive here from a terminal specifically to type this code
					autoFocus
					autoComplete="off"
					spellCheck={false}
					placeholder="XXXX-XXXX"
					maxLength={9}
					className="tnum w-full rounded-xl border border-ink-800 bg-ink-950 px-4 py-3 text-center font-mono text-2xl uppercase tracking-[0.2em] outline-none focus:border-accent"
				/>
				<button
					type="submit"
					className="mt-4 w-full rounded-xl bg-accent px-5 py-3 font-medium text-white transition hover:bg-accent-bright"
				>
					Approve
				</button>
			</Form>

			{actionData?.error && (
				<p className="mt-4 text-rose-400 text-sm" role="alert">
					{actionData.error}
				</p>
			)}

			<p className="mt-6 text-ink-700 text-xs leading-relaxed">
				Only approve a code you just generated yourself. It grants that terminal the
				ability to upload and manage files as you, until you revoke it in Settings.
			</p>
		</Shell>
	);
}

function Shell({ children }: { children: React.ReactNode }) {
	return (
		<main className="flex min-h-dvh flex-col items-center justify-center px-6">
			<div className="w-full max-w-sm">
				<p className="text-center font-semibold text-ink-500 text-sm tracking-tight">
					toss<span className="text-accent">it</span>
				</p>
				<div className="mt-6 rounded-2xl border border-ink-850 bg-ink-900/60 p-8">
					{children}
				</div>
			</div>
		</main>
	);
}
