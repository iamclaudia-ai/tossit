import { and, desc, eq, isNull } from "drizzle-orm";
import { useCallback, useEffect, useState } from "react";
import { Form, Link, useRevalidator } from "react-router";
import { AppHeader, navItem, Signature } from "~/components/brand";
import { copyText } from "~/components/copy-button";
import { Dropzone } from "~/components/dropzone";
import { FileRow } from "~/components/file-row";
import { cloudflareContext } from "~/context";
import { getDb } from "~/db";
import { files } from "~/db/schema";
import { type UploadItem, useUploads } from "~/hooks/use-uploads";
import { requireUser } from "~/lib/auth";
import { formatBytes, formatDuration, formatRate } from "~/lib/format";
import { getRequestOrigin } from "~/lib/origin";
import type { UploadResult } from "~/lib/uploader";
import type { Route } from "./+types/app";

export function meta(_: Route.MetaArgs) {
	return [{ title: "tossit" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const env = context.get(cloudflareContext).env;
	const { user, isAdmin, uploaderScope } = await requireUser(env, request);

	// uploaderScope is null for the owner (sees everything) and their own id for members.
	const rows = await getDb(env)
		.select()
		.from(files)
		.where(
			and(
				eq(files.status, "complete"),
				isNull(files.deletedAt),
				...(uploaderScope ? [eq(files.uploadedBy, uploaderScope)] : []),
			),
		)
		.orderBy(desc(files.completedAt))
		.limit(100);

	const origin = getRequestOrigin(request);
	return {
		email: user.email,
		isAdmin,
		files: rows.map((row) => ({
			id: row.id,
			filename: row.filename,
			size: row.size,
			url: `${origin}/d/${row.slug}`,
			completedAt: row.completedAt,
			expiresAt: row.expiresAt,
			maxDownloads: row.maxDownloads,
			downloadCount: row.downloadCount,
			viewCount: row.viewCount,
		})),
	};
}

export default function App({ loaderData }: Route.ComponentProps) {
	const revalidator = useRevalidator();
	const [toast, setToast] = useState<string | null>(null);

	// On completion the link is copied for you — that's the whole point of the product, and
	// making someone hunt for a Copy button after a 20-minute upload is a small betrayal.
	const handleComplete = useCallback(
		async (result: UploadResult) => {
			await copyText(result.url);
			setToast(`Link copied — ${result.filename}`);
			revalidator.revalidate();
		},
		[revalidator],
	);

	const { items, add, cancel, dismiss } = useUploads({ onComplete: handleComplete });

	useEffect(() => {
		if (!toast) return;
		const timer = setTimeout(() => setToast(null), 3200);
		return () => clearTimeout(timer);
	}, [toast]);

	const pending = items.filter((item) => item.status !== "done");
	const hasContent = pending.length > 0 || loaderData.files.length > 0;

	return (
		<div className="flex min-h-dvh flex-col">
			<AppHeader>
				<span className="mr-2 hidden text-muted sm:inline">{loaderData.email}</span>
				<Link to="/app/settings" className={navItem}>
					Settings
				</Link>
				{loaderData.isAdmin && (
					<>
						<Link to="/app/users" className={navItem}>
							People
						</Link>
						<Link to="/app/invites" className={navItem}>
							Invites
						</Link>
					</>
				)}
				<Form method="post" action="/auth/signout">
					<button type="submit" className={navItem}>
						Sign out
					</button>
				</Form>
			</AppHeader>

			<main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-8 sm:px-6">
				<Dropzone onFiles={add} compact={hasContent} />

				{pending.length > 0 && (
					<ul className="mt-4 space-y-2">
						{pending.map((item) => (
							<li key={item.key}>
								<UploadRow item={item} onCancel={cancel} onDismiss={dismiss} />
							</li>
						))}
					</ul>
				)}

				{loaderData.files.length > 0 && (
					<section className="mt-10">
						<h2 className="px-1 font-display text-ink text-xl">Your tosses</h2>
						<ul className="mt-3 divide-y divide-line/60 overflow-hidden rounded-2xl border border-line/70 bg-white/70 shadow-soft backdrop-blur-sm">
							{loaderData.files.map((file) => (
								<FileRow key={file.id} file={file} />
							))}
						</ul>
					</section>
				)}
			</main>

			<Signature />

			{toast && (
				<div className="-translate-x-1/2 fixed bottom-6 left-1/2 z-50 animate-toast">
					<div className="flex items-center gap-2 rounded-full border border-violet-200 bg-white px-4 py-2 text-sm shadow-lift">
						<span className="size-1.5 rounded-full bg-accent" />
						{toast}
					</div>
				</div>
			)}
		</div>
	);
}

function UploadRow({
	item,
	onCancel,
	onDismiss,
}: {
	item: UploadItem;
	onCancel: (key: string) => void;
	onDismiss: (key: string) => void;
}) {
	const percent = Math.round((item.progress?.fraction ?? 0) * 100);
	const failed = item.status === "error" || item.status === "cancelled";

	return (
		<div className="animate-rise relative overflow-hidden rounded-xl border border-line/70 bg-white/70 shadow-soft backdrop-blur-sm px-4 py-3">
			<div className="flex items-center gap-4">
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium text-sm">{item.file.name}</p>
					<p className="tnum mt-0.5 font-mono text-muted text-xs">
						{item.status === "uploading" && (
							<>
								{formatBytes(item.progress?.loaded ?? 0)} / {formatBytes(item.file.size)}
								{" · "}
								{formatRate(item.progress?.bytesPerSecond ?? null)}
								{" · "}
								{formatDuration(item.progress?.etaSeconds ?? null)} left
							</>
						)}
						{item.status === "cancelled" && "Cancelled"}
						{item.status === "error" && (
							<span className="text-rose-600">{item.error}</span>
						)}
					</p>
				</div>

				<span className="tnum font-mono text-ink-soft text-sm">
					{item.status === "uploading" ? `${percent}%` : ""}
				</span>

				<button
					type="button"
					onClick={() => (failed ? onDismiss(item.key) : onCancel(item.key))}
					className="rounded-full px-2 py-1 text-muted text-sm transition hover:bg-stone-100 hover:text-ink"
				>
					{failed ? "Dismiss" : "Cancel"}
				</button>
			</div>

			{/* Progress as the row's own bottom edge rather than a bolted-on bar. */}
			<div className="absolute inset-x-0 bottom-0 h-1 bg-violet-100/70">
				<div
					className={`h-full transition-[width] duration-200 ease-out ${
						failed ? "bg-rose-400" : "bg-signature"
					}`}
					style={{ width: `${failed ? 100 : percent}%` }}
				/>
			</div>
		</div>
	);
}
