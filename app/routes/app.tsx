import { and, desc, eq, isNull } from "drizzle-orm";
import { useCallback, useEffect, useState } from "react";
import { Form, useRevalidator } from "react-router";
import { CopyButton, copyText } from "~/components/copy-button";
import { Dropzone } from "~/components/dropzone";
import { getDb } from "~/db";
import { files } from "~/db/schema";
import { type UploadItem, useUploads } from "~/hooks/use-uploads";
import { requireUser } from "~/lib/auth";
import {
	formatAge,
	formatBytes,
	formatDuration,
	formatExpiry,
	formatRate,
} from "~/lib/format";
import { getRequestOrigin } from "~/lib/origin";
import type { UploadResult } from "~/lib/uploader";
import type { Route } from "./+types/app";

export function meta(_: Route.MetaArgs) {
	return [{ title: "tossit" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const { user, uploaderScope } = await requireUser(env, request);

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
		files: rows.map((row) => ({
			id: row.id,
			filename: row.filename,
			size: row.size,
			url: `${origin}/d/${row.slug}`,
			completedAt: row.completedAt,
			expiresAt: row.expiresAt,
			downloadCount: row.downloadCount,
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
		<div className="min-h-dvh">
			<header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
				<span className="font-semibold text-lg tracking-tight">
					toss<span className="text-accent">it</span>
				</span>
				<div className="flex items-center gap-3 text-sm">
					<span className="text-ink-500">{loaderData.email}</span>
					<Form method="post" action="/auth/signout">
						<button
							type="submit"
							className="rounded-lg px-3 py-1.5 text-ink-400 transition hover:bg-ink-900 hover:text-ink-200"
						>
							Sign out
						</button>
					</Form>
				</div>
			</header>

			<main className="mx-auto max-w-3xl px-6 pb-24">
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
						<h2 className="px-1 font-medium text-ink-500 text-xs uppercase tracking-widest">
							Your tosses
						</h2>
						<ul className="mt-3 divide-y divide-ink-900 overflow-hidden rounded-2xl border border-ink-900">
							{loaderData.files.map((file) => (
								<li
									key={file.id}
									className="flex items-center gap-4 bg-ink-900/40 px-4 py-3 transition hover:bg-ink-900"
								>
									<div className="min-w-0 flex-1">
										<p className="truncate font-medium text-sm">{file.filename}</p>
										<p className="tnum mt-0.5 font-mono text-ink-500 text-xs">
											{formatBytes(file.size)} · {formatAge(file.completedAt ?? 0)} ·{" "}
											{formatExpiry(file.expiresAt)}
											{file.downloadCount > 0 && ` · ${file.downloadCount} ↓`}
										</p>
									</div>
									<CopyButton value={file.url} />
								</li>
							))}
						</ul>
					</section>
				)}
			</main>

			{toast && (
				<div className="-translate-x-1/2 fixed bottom-6 left-1/2 z-50 animate-toast">
					<div className="flex items-center gap-2 rounded-full border border-accent-dim bg-ink-900 px-4 py-2 text-sm shadow-lg shadow-black/40">
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
		<div className="animate-rise relative overflow-hidden rounded-xl border border-ink-850 bg-ink-900/60 px-4 py-3">
			<div className="flex items-center gap-4">
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium text-sm">{item.file.name}</p>
					<p className="tnum mt-0.5 font-mono text-ink-500 text-xs">
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
							<span className="text-rose-400">{item.error}</span>
						)}
					</p>
				</div>

				<span className="tnum font-mono text-ink-400 text-sm">
					{item.status === "uploading" ? `${percent}%` : ""}
				</span>

				<button
					type="button"
					onClick={() => (failed ? onDismiss(item.key) : onCancel(item.key))}
					className="rounded-lg px-2 py-1 text-ink-500 text-sm transition hover:bg-ink-850 hover:text-ink-200"
				>
					{failed ? "Dismiss" : "Cancel"}
				</button>
			</div>

			{/* Progress as the row's own bottom edge rather than a bolted-on bar. */}
			<div className="absolute inset-x-0 bottom-0 h-0.5 bg-ink-850">
				<div
					className={`h-full transition-[width] duration-200 ease-out ${
						failed ? "bg-rose-500/60" : "bg-accent"
					}`}
					style={{ width: `${failed ? 100 : percent}%` }}
				/>
			</div>
		</div>
	);
}
