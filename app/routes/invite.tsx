import { useCallback, useState } from "react";
import { data, useNavigate } from "react-router";
import { Signature, Wordmark } from "~/components/brand";
import { Dropzone } from "~/components/dropzone";
import { cloudflareContext } from "~/context";
import { useUploads } from "~/hooks/use-uploads";
import { formatBytes } from "~/lib/format";
import { type InviteRejection, resolveInvite } from "~/lib/invites.server";
import { registerPasskey } from "~/lib/passkey-client";
import { checkRateLimit } from "~/lib/ratelimit.server";
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

export async function loader({ params, request, context }: Route.LoaderArgs) {
	const env = context.get(cloudflareContext).env;

	const limited = await checkRateLimit(env.INVITE_RATE, request, "i");
	if (limited) return limited;

	const resolution = await resolveInvite(env, params.code);

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
		<main className="flex min-h-dvh flex-col items-center px-4">
			<div className="flex w-full max-w-md flex-1 flex-col justify-center py-16">
				<p className="text-center">
					<Wordmark />
				</p>

				{loaderData.invite.kind === "upload" ? (
					<UploadInvite code={params.code} invite={loaderData.invite} />
				) : (
					<AccountInvite code={params.code} invite={loaderData.invite} />
				)}
			</div>
			<Signature />
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
			<div className="mt-6 rounded-2xl border border-line/70 bg-white/70 shadow-soft backdrop-blur-sm p-8 text-center">
				<div className="mx-auto flex size-11 items-center justify-center rounded-full bg-accent-soft">
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<title>Sent</title>
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
					Sent — thank you
				</h1>
				<p className="mt-1 break-all text-muted text-sm">{sent.filename}</p>
				<p className="mt-4 text-muted text-xs">
					This upload link has now been used and won't work again.
				</p>
			</div>
		);
	}

	return (
		<div className="mt-6">
			<h1 className="text-center font-display text-2xl text-ink tracking-tight">
				{invite.label ? `Send a file — ${invite.label}` : "Send a file"}
			</h1>
			<p className="mt-1 text-center text-muted text-sm">
				This is a private, one-time upload link. Nothing to sign up for.
			</p>

			<div className="mt-6">
				<Dropzone onFiles={add} compact={Boolean(active)} />
			</div>

			{active && (
				<div className="animate-rise mt-4 overflow-hidden rounded-xl border border-line/70 bg-white/70 shadow-soft backdrop-blur-sm px-4 py-3">
					<div className="flex items-center gap-3">
						<div className="min-w-0 flex-1">
							<p className="truncate font-medium text-sm">{active.file.name}</p>
							<p className="tnum mt-0.5 font-mono text-muted text-xs">
								{formatBytes(active.progress?.loaded ?? 0)} /{" "}
								{formatBytes(active.file.size)}
							</p>
						</div>
						<span className="tnum font-mono text-ink-soft text-sm">
							{Math.round((active.progress?.fraction ?? 0) * 100)}%
						</span>
						<button
							type="button"
							onClick={() => cancel(active.key)}
							className="rounded-full px-2 py-1 text-muted text-sm hover:text-ink"
						>
							Cancel
						</button>
					</div>
					<div className="mt-2 h-1 overflow-hidden rounded-full bg-violet-100/70">
						<div
							className="h-full bg-signature transition-[width] duration-200"
							style={{ width: `${Math.round((active.progress?.fraction ?? 0) * 100)}%` }}
						/>
					</div>
				</div>
			)}

			{items.some((item) => item.status === "error") && (
				<p className="mt-3 text-center text-rose-600 text-sm">
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
		<div className="mt-6 rounded-2xl border border-line/70 bg-white/70 shadow-soft backdrop-blur-sm p-8">
			<h1 className="font-display text-2xl text-ink tracking-tight">
				{invite.label ? `You're invited — ${invite.label}` : "You're invited to tossit"}
			</h1>
			<p className="mt-1 text-muted text-sm">
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
						className="w-full rounded-xl border border-line bg-white/80 px-4 py-3 outline-none read-only:text-ink-soft focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
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
						className="tnum w-full rounded-xl border border-line bg-white/80 px-4 py-3 text-center font-mono text-2xl tracking-[0.3em] outline-none focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
					/>
					<Submit busy={busy} label="Verify" />
					<button
						type="button"
						onClick={() =>
							run(async () => void (await post("/auth/otp/request", { code, email })))
						}
						className="mt-3 w-full text-muted text-xs hover:text-ink"
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
						className="w-full rounded-full bg-accent px-5 py-3 font-medium text-white transition shadow-soft hover:bg-accent-strong disabled:opacity-50"
					>
						{busy ? "Waiting for your device…" : "Create passkey"}
					</button>
					<p className="mt-3 text-center text-muted text-xs">
						No password. Your device or password manager holds the key.
					</p>
				</div>
			)}

			{error && (
				<p className="mt-4 text-rose-600 text-sm" role="alert">
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
			className="mt-4 w-full rounded-full bg-accent px-5 py-3 font-medium text-white transition shadow-soft hover:bg-accent-strong disabled:opacity-50"
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
		<main className="flex min-h-dvh flex-col items-center px-4">
			<div className="flex w-full max-w-sm flex-1 flex-col justify-center py-16 text-center">
				<p className="text-center">
					<Wordmark />
				</p>
				<h1 className="mt-6 font-display text-2xl text-ink tracking-tight">
					Invitation unavailable
				</h1>
				<p className="mt-2 text-balance text-muted text-sm leading-relaxed">
					{MESSAGES[reason] ?? MESSAGES.missing}
				</p>
			</div>
			<Signature />
		</main>
	);
}
