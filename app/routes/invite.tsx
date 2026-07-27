import { useCallback, useState } from "react";
import { data, useNavigate } from "react-router";
import { Dropzone } from "~/components/dropzone";
import { useUploads } from "~/hooks/use-uploads";
import { formatBytes } from "~/lib/format";
import { type InviteRejection, resolveInvite } from "~/lib/invites.server";
import { registerPasskey } from "~/lib/passkey-client";
import type { Route } from "./+types/invite";

export function meta() {
	return [
		{ title: "You've been invited — tossit" },
		{ name: "robots", content: "noindex, nofollow" },
	];
}

export const headers: Route.HeadersFunction = () => ({
	"x-robots-tag": "noindex, nofollow",
	"cache-control": "private, no-store",
});

export async function loader({ params, context }: Route.LoaderArgs) {
	const resolution = await resolveInvite(context.cloudflare.env, params.code);

	if (!resolution.ok) {
		return data({ invite: null, reason: resolution.reason }, { status: 410 });
	}

	const { invite } = resolution;
	return {
		invite: {
			kind: invite.kind,
			label: invite.label,
			email: invite.email,
			remaining: invite.kind === "upload" ? (invite.maxUploads ?? 1) - invite.uses : null,
		},
		reason: null,
	};
}

export default function InvitePage({ loaderData, params }: Route.ComponentProps) {
	if (!loaderData.invite) {
		return <Unavailable reason={loaderData.reason as InviteRejection} />;
	}

	return (
		<main className="flex min-h-dvh flex-col items-center justify-center px-6 py-16">
			<div className="w-full max-w-md">
				<p className="text-center font-semibold text-ink-500 text-sm tracking-tight">
					toss<span className="text-accent">it</span>
				</p>

				{loaderData.invite.kind === "upload" ? (
					<UploadInvite code={params.code} invite={loaderData.invite} />
				) : (
					<AccountInvite code={params.code} invite={loaderData.invite} />
				)}
			</div>
		</main>
	);
}

interface InviteInfo {
	kind: "upload" | "account";
	label: string | null;
	email: string | null;
	remaining: number | null;
}

/** Anonymous, one file, no account. */
function UploadInvite({ code, invite }: { code: string; invite: InviteInfo }) {
	const [sent, setSent] = useState<{ filename: string } | null>(null);

	const { items, add, cancel } = useUploads({
		basePath: `/i/${code}`,
		onComplete: (result) => setSent({ filename: result.filename }),
	});

	const active = items.find((item) => item.status === "uploading");

	if (sent) {
		return (
			<div className="mt-6 rounded-2xl border border-ink-850 bg-ink-900/60 p-8 text-center">
				<div className="mx-auto flex size-11 items-center justify-center rounded-full bg-accent/15">
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<title>Sent</title>
						<path
							d="m5 12.5 4.5 4.5L19 7.5"
							stroke="oklch(0.76 0.17 300)"
							strokeWidth="2.2"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				</div>
				<h1 className="mt-4 font-medium text-lg">Sent — thank you</h1>
				<p className="mt-1 break-all text-ink-500 text-sm">{sent.filename}</p>
				<p className="mt-4 text-ink-700 text-xs">
					This upload link has now been used and won't work again.
				</p>
			</div>
		);
	}

	return (
		<div className="mt-6">
			<h1 className="text-center font-medium text-lg tracking-tight">
				{invite.label ? `Send a file — ${invite.label}` : "Send a file"}
			</h1>
			<p className="mt-1 text-center text-ink-500 text-sm">
				This is a private, one-time upload link. Nothing to sign up for.
			</p>

			<div className="mt-6">
				<Dropzone onFiles={add} compact={Boolean(active)} />
			</div>

			{active && (
				<div className="animate-rise mt-4 overflow-hidden rounded-xl border border-ink-850 bg-ink-900/60 px-4 py-3">
					<div className="flex items-center gap-3">
						<div className="min-w-0 flex-1">
							<p className="truncate font-medium text-sm">{active.file.name}</p>
							<p className="tnum mt-0.5 font-mono text-ink-500 text-xs">
								{formatBytes(active.progress?.loaded ?? 0)} /{" "}
								{formatBytes(active.file.size)}
							</p>
						</div>
						<span className="tnum font-mono text-ink-400 text-sm">
							{Math.round((active.progress?.fraction ?? 0) * 100)}%
						</span>
						<button
							type="button"
							onClick={() => cancel(active.key)}
							className="rounded-lg px-2 py-1 text-ink-500 text-sm hover:text-ink-200"
						>
							Cancel
						</button>
					</div>
					<div className="mt-2 h-0.5 bg-ink-850">
						<div
							className="h-full bg-accent transition-[width] duration-200"
							style={{ width: `${Math.round((active.progress?.fraction ?? 0) * 100)}%` }}
						/>
					</div>
				</div>
			)}

			{items.some((item) => item.status === "error") && (
				<p className="mt-3 text-center text-rose-400 text-sm">
					{items.find((item) => item.status === "error")?.error}
				</p>
			)}
		</div>
	);
}

/** Email → OTP → passkey, three steps and no more. */
function AccountInvite({ code, invite }: { code: string; invite: InviteInfo }) {
	const navigate = useNavigate();
	const [step, setStep] = useState<"email" | "otp" | "passkey">("email");
	const [email, setEmail] = useState(invite.email ?? "");
	const [otp, setOtp] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const post = useCallback(async (url: string, body: unknown) => {
		const response = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		const payload = (await response.json()) as Record<string, unknown>;
		if (!response.ok)
			throw new Error((payload.error as string) ?? "Something went wrong.");
		return payload;
	}, []);

	const run = async (action: () => Promise<void>) => {
		setBusy(true);
		setError(null);
		try {
			await action();
		} catch (cause) {
			const message = (cause as Error).message ?? "Something went wrong.";
			setError(/NotAllowed|abort/i.test(message) ? "Cancelled." : message);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="mt-6 rounded-2xl border border-ink-850 bg-ink-900/60 p-8">
			<h1 className="font-medium text-lg tracking-tight">
				{invite.label ? `You're invited — ${invite.label}` : "You're invited to tossit"}
			</h1>
			<p className="mt-1 text-ink-500 text-sm">
				{step === "email" && "First, confirm your email address."}
				{step === "otp" && `Enter the 6-digit code sent to ${email}.`}
				{step === "passkey" && "Last step — create a passkey to sign in from now on."}
			</p>

			{step === "email" && (
				<form
					className="mt-6"
					onSubmit={(event) => {
						event.preventDefault();
						run(async () => {
							await post("/auth/otp/request", { code, email });
							setStep("otp");
						});
					}}
				>
					<input
						type="email"
						required
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						// Locked when the invite names a specific address — a mismatch is refused
						// server-side anyway, so let the field say so up front.
						readOnly={Boolean(invite.email)}
						placeholder="you@example.com"
						className="w-full rounded-xl border border-ink-800 bg-ink-950 px-4 py-3 outline-none read-only:text-ink-400 focus:border-accent"
					/>
					<Submit busy={busy} label="Send me a code" />
				</form>
			)}

			{step === "otp" && (
				<form
					className="mt-6"
					onSubmit={(event) => {
						event.preventDefault();
						run(async () => {
							await post("/auth/otp/verify", { code, email, otp });
							setStep("passkey");
						});
					}}
				>
					<input
						inputMode="numeric"
						autoComplete="one-time-code"
						required
						maxLength={6}
						value={otp}
						onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))}
						placeholder="000000"
						className="tnum w-full rounded-xl border border-ink-800 bg-ink-950 px-4 py-3 text-center font-mono text-2xl tracking-[0.3em] outline-none focus:border-accent"
					/>
					<Submit busy={busy} label="Verify" />
					<button
						type="button"
						onClick={() =>
							run(async () => void (await post("/auth/otp/request", { code, email })))
						}
						className="mt-3 w-full text-ink-500 text-xs hover:text-ink-200"
					>
						Send a new code
					</button>
				</form>
			)}

			{step === "passkey" && (
				<div className="mt-6">
					<button
						type="button"
						disabled={busy}
						onClick={() =>
							run(async () => {
								await registerPasskey();
								navigate("/app");
							})
						}
						className="w-full rounded-xl bg-accent px-5 py-3 font-medium text-white transition hover:bg-accent-bright disabled:opacity-50"
					>
						{busy ? "Waiting for your device…" : "Create passkey"}
					</button>
					<p className="mt-3 text-center text-ink-700 text-xs">
						No password. Your device or password manager holds the key.
					</p>
				</div>
			)}

			{error && (
				<p className="mt-4 text-rose-400 text-sm" role="alert">
					{error}
				</p>
			)}
		</div>
	);
}

function Submit({ busy, label }: { busy: boolean; label: string }) {
	return (
		<button
			type="submit"
			disabled={busy}
			className="mt-4 w-full rounded-xl bg-accent px-5 py-3 font-medium text-white transition hover:bg-accent-bright disabled:opacity-50"
		>
			{busy ? "Working…" : label}
		</button>
	);
}

const MESSAGES: Record<InviteRejection, string> = {
	missing: "This invitation link doesn't exist. Check the address, or ask for a new one.",
	revoked: "This invitation was revoked. Ask the sender for a new one.",
	expired: "This invitation has expired. Ask the sender for a new one.",
	used: "This invitation has already been used.",
};

function Unavailable({ reason }: { reason: InviteRejection }) {
	return (
		<main className="flex min-h-dvh flex-col items-center justify-center px-6">
			<div className="w-full max-w-sm text-center">
				<p className="font-semibold text-ink-500 text-sm tracking-tight">
					toss<span className="text-accent">it</span>
				</p>
				<h1 className="mt-6 font-medium text-xl tracking-tight">
					Invitation unavailable
				</h1>
				<p className="mt-2 text-balance text-ink-500 text-sm leading-relaxed">
					{MESSAGES[reason] ?? MESSAGES.missing}
				</p>
			</div>
		</main>
	);
}
