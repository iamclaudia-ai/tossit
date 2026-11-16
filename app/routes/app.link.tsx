import { data, Form, Link, useSearchParams } from "react-router";
import { Logo, Signature } from "~/components/brand";
import { cloudflareContext } from "~/context";
import { requireUser } from "~/lib/auth";
import { approveDeviceAuth, findPendingAuth } from "~/lib/device.server";
import type { Route } from "./+types/app.link";

export function meta() {
	return [{ title: "Link a device — tossit" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	// Approving a device requires a real, passkey-backed session — never a device token.
	await requireUser(context.get(cloudflareContext).env, request);
	return null;
}

export async function action({ request, context }: Route.ActionArgs) {
	const env = context.get(cloudflareContext).env;
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
					<div className="mx-auto flex size-11 items-center justify-center rounded-full bg-accent-soft">
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
								stroke="var(--color-violet-600)"
								strokeWidth="2.2"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
					</div>
					<h1 className="mt-4 font-display text-2xl text-ink tracking-tight">
						Device linked
					</h1>
					<p className="mt-1 text-muted text-sm">
						Your terminal is signed in. You can close this tab.
					</p>
					<Link
						to="/app/settings"
						className="mt-6 inline-block text-accent text-sm hover:text-accent-strong"
					>
						Manage device tokens
					</Link>
				</div>
			</Shell>
		);
	}

	return (
		<Shell>
			<h1 className="font-display text-2xl text-ink tracking-tight">Link a device</h1>
			<p className="mt-1 text-muted text-sm">Enter the code shown in your terminal.</p>

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
					className="tnum w-full rounded-xl border border-line bg-white/80 px-4 py-3 text-center font-mono text-2xl uppercase tracking-[0.2em] outline-none focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
				/>
				<button
					type="submit"
					className="mt-4 w-full rounded-full bg-accent px-5 py-3 font-medium text-white transition shadow-soft hover:bg-accent-strong"
				>
					Approve
				</button>
			</Form>

			{actionData?.error && (
				<p className="mt-4 text-rose-600 text-sm" role="alert">
					{actionData.error}
				</p>
			)}

			<p className="mt-6 text-muted text-xs leading-relaxed">
				Only approve a code you just generated yourself. It grants that terminal the
				ability to upload and manage files as you, until you revoke it in Settings.
			</p>
		</Shell>
	);
}

function Shell({ children }: { children: React.ReactNode }) {
	return (
		<main className="flex min-h-dvh flex-col items-center px-4">
			<div className="flex w-full max-w-sm flex-1 flex-col justify-center py-16">
				<p className="text-center">
					<Logo arrive />
				</p>
				<div className="mt-6 rounded-2xl border border-line/70 bg-white/70 shadow-soft backdrop-blur-sm p-8">
					{children}
				</div>
			</div>
			<Signature />
		</main>
	);
}
