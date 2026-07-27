import { asc, eq, sql } from "drizzle-orm";
import { useState } from "react";
import { data, Link, useFetcher } from "react-router";
import { getDb } from "~/db";
import { credentials, files, sessions, users } from "~/db/schema";
import { requireAdmin } from "~/lib/auth";
import { formatAge } from "~/lib/format";
import type { Route } from "./+types/app.users";

export function meta() {
	return [{ title: "People — tossit" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const { user } = await requireAdmin(env, request);
	const db = getDb(env);

	const rows = await db
		.select({
			id: users.id,
			email: users.email,
			role: users.role,
			createdAt: users.createdAt,
			fileCount: sql<number>`(select count(*) from files where files.uploaded_by = users.id and files.deleted_at is null)`,
			passkeyCount: sql<number>`(select count(*) from credentials where credentials.user_id = users.id)`,
		})
		.from(users)
		// Owner first, then admins, then members — the hierarchy reads top to bottom.
		.orderBy(
			sql`case users.role when 'owner' then 0 when 'admin' then 1 else 2 end`,
			asc(users.createdAt),
		)
		.all();

	return { me: user.id, people: rows };
}

export async function action({ request, context }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const { user } = await requireAdmin(env, request);
	const db = getDb(env);

	const form = await request.formData();
	const intent = form.get("intent");
	const targetId = String(form.get("id") ?? "");

	const fail = (message: string, status = 400) =>
		data({ ok: false, error: message }, { status });

	if (!targetId) return fail("Missing user.");
	if (targetId === user.id) {
		// Blocks the two most common ways to lock yourself out by accident.
		return fail("You can't change your own account here.");
	}

	const target = await db.select().from(users).where(eq(users.id, targetId)).get();
	if (!target) return fail("Not found.", 404);

	// The owner is the floor of the permission system: no admin can demote or remove them, and
	// the owner can't do it to themselves either (blocked above). There is always a way back in.
	if (target.role === "owner") return fail("The owner account can't be changed.", 403);

	if (intent === "set-role") {
		const role = String(form.get("role") ?? "");
		if (role !== "admin" && role !== "member") {
			// Ownership is granted by bootstrap alone, never through the app.
			return fail("Role must be admin or member.");
		}
		await db.update(users).set({ role }).where(eq(users.id, target.id));
		return { ok: true, error: null };
	}

	if (intent === "remove-user") {
		// Files are deliberately kept — they may be things you were sent and still need. With
		// uploaded_by nulled they simply become owner/admin-visible.
		await db
			.update(files)
			.set({ uploadedBy: null })
			.where(eq(files.uploadedBy, target.id));
		await db.delete(sessions).where(eq(sessions.userId, target.id));
		await db.delete(credentials).where(eq(credentials.userId, target.id));
		await db.delete(users).where(eq(users.id, target.id));
		return { ok: true, error: null };
	}

	return fail("Unknown action.");
}

const ROLE_STYLES: Record<string, string> = {
	owner: "bg-accent/15 text-accent",
	admin: "bg-ink-850 text-ink-200",
	member: "bg-ink-850 text-ink-400",
};

export default function People({ loaderData, actionData }: Route.ComponentProps) {
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
				<h1 className="font-medium text-2xl tracking-tight">People</h1>
				<p className="mt-1 text-ink-500 text-sm">
					Admins can do everything you can, except change the owner.
				</p>

				{actionData?.error && (
					<p className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-rose-400 text-sm">
						{actionData.error}
					</p>
				)}

				<ul className="mt-6 divide-y divide-ink-900 overflow-hidden rounded-2xl border border-ink-900">
					{loaderData.people.map((person) => (
						<PersonRow
							key={person.id}
							person={person}
							isMe={person.id === loaderData.me}
						/>
					))}
				</ul>

				<p className="mt-4 text-ink-700 text-xs">
					Removing someone deletes their account, passkeys, and sessions. Files they
					uploaded are kept and become visible to admins.
				</p>
			</main>
		</div>
	);
}

type Person = Awaited<ReturnType<typeof loader>>["people"][number];

function PersonRow({ person, isMe }: { person: Person; isMe: boolean }) {
	const fetcher = useFetcher();
	const [confirming, setConfirming] = useState(false);
	const locked = person.role === "owner" || isMe;

	if (fetcher.data?.ok && fetcher.state === "idle" && confirming) return null;

	const submit = (fields: Record<string, string>) =>
		fetcher.submit(
			{ ...fields, id: person.id },
			{ method: "post", action: "/app/users" },
		);

	return (
		<li className="flex flex-wrap items-center gap-3 bg-ink-900/40 px-4 py-3">
			<div className="min-w-0 flex-1">
				<p className="truncate font-medium text-sm">
					{person.email}
					{isMe && <span className="ml-2 text-ink-600 text-xs">you</span>}
				</p>
				<p className="tnum mt-0.5 font-mono text-ink-500 text-xs">
					joined {formatAge(person.createdAt)} · {person.fileCount} file
					{person.fileCount === 1 ? "" : "s"} · {person.passkeyCount} passkey
					{person.passkeyCount === 1 ? "" : "s"}
				</p>
			</div>

			<span
				className={`rounded px-2 py-0.5 font-medium text-xs ${ROLE_STYLES[person.role]}`}
			>
				{person.role}
			</span>

			{!locked && (
				<>
					<select
						defaultValue={person.role}
						disabled={fetcher.state !== "idle"}
						onChange={(event) => submit({ intent: "set-role", role: event.target.value })}
						className="rounded-lg border border-ink-800 bg-ink-900 px-2 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-50"
					>
						<option value="member">member</option>
						<option value="admin">admin</option>
					</select>

					{confirming ? (
						<span className="flex items-center gap-2">
							<span className="text-ink-400 text-xs">Remove {person.email}?</span>
							<button
								type="button"
								onClick={() => setConfirming(false)}
								className="rounded-lg px-2 py-1 text-ink-500 text-sm hover:text-ink-200"
							>
								No
							</button>
							<button
								type="button"
								onClick={() => submit({ intent: "remove-user" })}
								className="rounded-lg bg-rose-500/90 px-3 py-1.5 font-medium text-sm text-white transition hover:bg-rose-500"
							>
								Remove
							</button>
						</span>
					) : (
						<button
							type="button"
							onClick={() => setConfirming(true)}
							className="rounded-lg px-3 py-1.5 text-ink-500 text-sm transition hover:bg-rose-500/10 hover:text-rose-400"
						>
							Remove
						</button>
					)}
				</>
			)}
		</li>
	);
}
