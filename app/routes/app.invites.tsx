import { desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { Form, Link, useFetcher } from "react-router";
import { CopyButton } from "~/components/copy-button";
import { getDb } from "~/db";
import { invites } from "~/db/schema";
import { requireOwner } from "~/lib/auth";
import { formatAge, formatExpiry } from "~/lib/format";
import { getRequestOrigin } from "~/lib/origin";
import { generateInviteCode } from "~/lib/tokens";
import type { Route } from "./+types/app.invites";

export function meta() {
	return [{ title: "Invites — tossit" }, { name: "robots", content: "noindex" }];
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function loader({ request, context }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	// Only the owner issues invites; members can upload but not widen access.
	await requireOwner(env, request);

	const rows = await getDb(env)
		.select()
		.from(invites)
		.orderBy(desc(invites.createdAt))
		.limit(50);
	const origin = getRequestOrigin(request);

	return {
		invites: rows.map((row) => ({
			id: row.id,
			kind: row.kind,
			label: row.label,
			email: row.email,
			url: `${origin}/i/${row.code}`,
			uses: row.uses,
			maxUploads: row.maxUploads,
			createdAt: row.createdAt,
			expiresAt: row.expiresAt,
			claimedAt: row.claimedAt,
			revokedAt: row.revokedAt,
		})),
	};
}

export async function action({ request, context }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const { user } = await requireOwner(env, request);

	const form = await request.formData();
	const kind = form.get("kind");
	if (kind !== "upload" && kind !== "account") {
		return Response.json({ error: "Pick an invite type." }, { status: 400 });
	}

	const label = (form.get("label") as string | null)?.trim() || null;
	const email = (form.get("email") as string | null)?.trim().toLowerCase() || null;

	const now = Date.now();
	await getDb(env)
		.insert(invites)
		.values({
			id: nanoid(),
			code: generateInviteCode(),
			kind,
			label: label?.slice(0, 120) ?? null,
			email: kind === "account" ? email : null,
			// Upload invites are single-use by design; account invites don't use this field.
			maxUploads: kind === "upload" ? 1 : null,
			uses: 0,
			createdBy: user.id,
			createdAt: now,
			expiresAt: now + INVITE_TTL_MS,
		});

	return Response.json({ ok: true });
}

export default function Invites({ loaderData }: Route.ComponentProps) {
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
				<h1 className="font-medium text-2xl tracking-tight">Invites</h1>
				<p className="mt-1 text-ink-500 text-sm">
					Let someone send you a file, or give them their own account.
				</p>

				<Form
					method="post"
					className="mt-6 rounded-2xl border border-ink-850 bg-ink-900/40 p-5"
				>
					<div className="flex flex-wrap items-end gap-3">
						<label className="flex flex-col gap-1">
							<span className="font-medium text-ink-500 text-xs uppercase tracking-wide">
								Type
							</span>
							<select
								name="kind"
								defaultValue="upload"
								className="rounded-lg border border-ink-800 bg-ink-900 px-2.5 py-2 text-sm outline-none focus:border-accent"
							>
								<option value="upload">Upload link (one file, no account)</option>
								<option value="account">Account invite (email + passkey)</option>
							</select>
						</label>

						<label className="flex min-w-40 flex-1 flex-col gap-1">
							<span className="font-medium text-ink-500 text-xs uppercase tracking-wide">
								Label
							</span>
							<input
								name="label"
								placeholder="Dave from the podcast"
								className="rounded-lg border border-ink-800 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-accent"
							/>
						</label>

						<label className="flex min-w-48 flex-1 flex-col gap-1">
							<span className="font-medium text-ink-500 text-xs uppercase tracking-wide">
								Email <span className="normal-case">(account invites only)</span>
							</span>
							<input
								name="email"
								type="email"
								placeholder="dave@example.com"
								className="rounded-lg border border-ink-800 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-accent"
							/>
						</label>

						<button
							type="submit"
							className="rounded-lg bg-accent px-4 py-2 font-medium text-sm text-white transition hover:bg-accent-bright"
						>
							Create
						</button>
					</div>
					<p className="mt-3 text-ink-700 text-xs">
						Invites expire after 7 days. Upload links work once, then die.
					</p>
				</Form>

				{loaderData.invites.length > 0 && (
					<ul className="mt-8 divide-y divide-ink-900 overflow-hidden rounded-2xl border border-ink-900">
						{loaderData.invites.map((invite) => (
							<InviteRow key={invite.id} invite={invite} />
						))}
					</ul>
				)}
			</main>
		</div>
	);
}

type InviteItem = Awaited<ReturnType<typeof loader>>["invites"][number];

function InviteRow({ invite }: { invite: InviteItem }) {
	const revoke = useFetcher();
	const dead =
		invite.revokedAt !== null ||
		revoke.state !== "idle" ||
		(invite.expiresAt !== null && invite.expiresAt <= Date.now()) ||
		(invite.kind === "upload"
			? invite.uses >= (invite.maxUploads ?? 1)
			: invite.claimedAt !== null);

	return (
		<li className={`bg-ink-900/40 px-4 py-3 ${dead ? "opacity-45" : ""}`}>
			<div className="flex items-center gap-3">
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium text-sm">
						{invite.label ??
							(invite.kind === "upload" ? "Upload link" : "Account invite")}
						<span className="ml-2 rounded bg-ink-850 px-1.5 py-0.5 font-normal text-ink-400 text-xs">
							{invite.kind}
						</span>
					</p>
					<p className="tnum mt-0.5 font-mono text-ink-500 text-xs">
						{invite.email && `${invite.email} · `}
						{formatAge(invite.createdAt)} · {formatExpiry(invite.expiresAt)}
						{invite.kind === "upload" &&
							` · ${invite.uses}/${invite.maxUploads ?? 1} used`}
						{invite.revokedAt !== null && " · revoked"}
						{invite.claimedAt !== null && " · claimed"}
					</p>
				</div>

				{!dead && (
					<>
						<CopyButton value={invite.url} label="Copy invite" />
						<button
							type="button"
							onClick={() =>
								revoke.submit(null, {
									method: "post",
									action: `/app/invites/${invite.id}/revoke`,
								})
							}
							className="rounded-lg px-3 py-1.5 text-ink-500 text-sm transition hover:bg-rose-500/10 hover:text-rose-400"
						>
							Revoke
						</button>
					</>
				)}
			</div>
		</li>
	);
}
