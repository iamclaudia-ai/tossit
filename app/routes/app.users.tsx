import { asc, eq, sql } from "drizzle-orm";
import { useState } from "react";
import { data, Link, useFetcher } from "react-router";
import { AppHeader, navItem, Signature } from "~/components/brand";
import { cloudflareContext } from "~/context";
import { getDb } from "~/db";
import { credentials, files, sessions, users } from "~/db/schema";
import { requireAdmin } from "~/lib/auth";
import { formatAge } from "~/lib/format";
import type { Route } from "./+types/app.users";

export function meta() {
	return [{ title: "People — tossit" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const env = context.get(cloudflareContext).env;
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
	const env = context.get(cloudflareContext).env;
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
	owner: "border-violet-200/70 bg-violet-50 text-violet-700",
	admin: "border-rose-200/70 bg-rose-50 text-rose-700",
	member: "border-stone-200 bg-stone-50 text-ink-soft",
};

export default function People({ loaderData, actionData }: Route.ComponentProps) {
	return (
		<div className="flex min-h-dvh flex-col">
			<AppHeader>
				<Link to="/app" className={navItem}>
					Back to files
				</Link>
			</AppHeader>

			<main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-8 sm:px-6">
				<h1 className="font-display text-4xl text-ink tracking-tight">People</h1>
				<p className="mt-1 text-muted text-sm">
					Admins can do everything you can, except change the owner.
				</p>

				{actionData?.error && (
					<p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-rose-600 text-sm">
						{actionData.error}
					</p>
				)}

				<ul className="mt-6 divide-y divide-line/60 overflow-hidden rounded-2xl border border-line/70 bg-white/70 shadow-soft backdrop-blur-sm">
					{loaderData.people.map((person) => (
						<PersonRow
							key={person.id}
							person={person}
							isMe={person.id === loaderData.me}
						/>
					))}
				</ul>

				<p className="mt-4 text-muted text-xs">
					Removing someone deletes their account, passkeys, and sessions. Files they
					uploaded are kept and become visible to admins.
				</p>
			</main>
			<Signature />
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
		<li className="flex flex-wrap items-center gap-3 px-4 py-3">
			<div className="min-w-0 flex-1">
				<p className="truncate font-medium text-sm">
					{person.email}
					{isMe && <span className="ml-2 text-muted text-xs">you</span>}
				</p>
				<p className="tnum mt-0.5 font-mono text-muted text-xs">
					joined {formatAge(person.createdAt)} · {person.fileCount} file
					{person.fileCount === 1 ? "" : "s"} · {person.passkeyCount} passkey
					{person.passkeyCount === 1 ? "" : "s"}
				</p>
			</div>

			<span
				className={`rounded-full border px-2.5 py-0.5 font-medium text-xs ${ROLE_STYLES[person.role]}`}
			>
				{person.role}
			</span>

			{!locked && (
				<>
					<select
						defaultValue={person.role}
						disabled={fetcher.state !== "idle"}
						onChange={(event) => submit({ intent: "set-role", role: event.target.value })}
						className="rounded-xl border border-line bg-white px-2 py-1.5 text-sm outline-none focus:border-violet-300 focus:ring-4 focus:ring-violet-100 disabled:opacity-50"
					>
						<option value="member">member</option>
						<option value="admin">admin</option>
					</select>

					{confirming ? (
						<span className="flex items-center gap-2">
							<span className="text-ink-soft text-xs">Remove {person.email}?</span>
							<button
								type="button"
								onClick={() => setConfirming(false)}
								className="rounded-full px-2 py-1 text-muted text-sm hover:text-ink"
							>
								No
							</button>
							<button
								type="button"
								onClick={() => submit({ intent: "remove-user" })}
								className="rounded-full bg-rose-500 px-3 py-1.5 font-medium text-sm text-white transition hover:bg-rose-600"
							>
								Remove
							</button>
						</span>
					) : (
						<button
							type="button"
							onClick={() => setConfirming(true)}
							className="rounded-full px-3 py-1.5 text-muted text-sm transition hover:bg-rose-50 hover:text-rose-700"
						>
							Remove
						</button>
					)}
				</>
			)}
		</li>
	);
}
