import { useState } from "react";
import { useFetcher } from "react-router";
import { formatAge, formatBytes, formatExpiry } from "~/lib/format";
import { CopyButton } from "./copy-button";

export interface ManagedFile {
	id: string;
	filename: string;
	size: number | null;
	url: string;
	completedAt: number | null;
	expiresAt: number | null;
	maxDownloads: number | null;
	downloadCount: number;
}

const EXPIRY_CHOICES = [
	{ value: "1h", label: "1 hour" },
	{ value: "24h", label: "24 hours" },
	{ value: "7d", label: "7 days" },
	{ value: "30d", label: "30 days" },
	{ value: "never", label: "Never" },
];

const DOWNLOAD_CHOICES = [
	{ value: "1", label: "1 more" },
	{ value: "5", label: "5 more" },
	{ value: "25", label: "25 more" },
	{ value: "unlimited", label: "Unlimited" },
];

export function FileRow({ file }: { file: ManagedFile }) {
	const [open, setOpen] = useState(false);
	const settings = useFetcher();
	const remove = useFetcher();

	// Optimistic: drop the row the moment delete is submitted rather than waiting a round trip.
	if (remove.state !== "idle" || remove.data?.ok) return null;

	const remaining =
		file.maxDownloads === null ? null : file.maxDownloads - file.downloadCount;

	return (
		<li className="bg-ink-900/40 transition hover:bg-ink-900">
			<div className="flex items-center gap-3 px-4 py-3">
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium text-sm">{file.filename}</p>
					<p className="tnum mt-0.5 font-mono text-ink-500 text-xs">
						{formatBytes(file.size)} · {formatAge(file.completedAt ?? 0)} ·{" "}
						{formatExpiry(file.expiresAt)}
						{file.downloadCount > 0 && ` · ${file.downloadCount} ↓`}
						{remaining !== null && ` · ${remaining} left`}
					</p>
				</div>

				<CopyButton value={file.url} />

				<button
					type="button"
					onClick={() => setOpen((v) => !v)}
					aria-expanded={open}
					aria-label={`Settings for ${file.filename}`}
					className={`rounded-lg px-2 py-1.5 text-sm transition hover:bg-ink-850 ${
						open ? "text-accent" : "text-ink-500 hover:text-ink-200"
					}`}
				>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
						<title>Settings</title>
						<circle cx="8" cy="3" r="1.4" fill="currentColor" />
						<circle cx="8" cy="8" r="1.4" fill="currentColor" />
						<circle cx="8" cy="13" r="1.4" fill="currentColor" />
					</svg>
				</button>
			</div>

			{open && (
				<div className="animate-rise border-ink-850 border-t bg-ink-950/40 px-4 py-4">
					<settings.Form
						method="post"
						action={`/app/files/${file.id}/settings`}
						className="flex flex-wrap items-end gap-3"
					>
						<Field label="Expires in">
							<select
								name="expiry"
								defaultValue=""
								className="rounded-lg border border-ink-800 bg-ink-900 px-2.5 py-1.5 text-sm outline-none focus:border-accent"
							>
								<option value="">Unchanged</option>
								{EXPIRY_CHOICES.map((choice) => (
									<option key={choice.value} value={choice.value}>
										{choice.label}
									</option>
								))}
							</select>
						</Field>

						<Field label="Downloads allowed">
							<select
								name="downloads"
								defaultValue=""
								className="rounded-lg border border-ink-800 bg-ink-900 px-2.5 py-1.5 text-sm outline-none focus:border-accent"
							>
								<option value="">Unchanged</option>
								{DOWNLOAD_CHOICES.map((choice) => (
									<option key={choice.value} value={choice.value}>
										{choice.label}
									</option>
								))}
							</select>
						</Field>

						<button
							type="submit"
							disabled={settings.state !== "idle"}
							className="rounded-lg bg-accent px-3 py-1.5 font-medium text-sm text-white transition hover:bg-accent-bright disabled:opacity-50"
						>
							{settings.state !== "idle" ? "Saving…" : "Save"}
						</button>

						{settings.data?.ok && settings.state === "idle" && (
							<span className="text-accent text-xs">Saved</span>
						)}
						{settings.data?.error && (
							<span className="text-rose-400 text-xs">{settings.data.error}</span>
						)}

						<div className="ml-auto">
							<DeleteButton file={file} fetcher={remove} />
						</div>
					</settings.Form>
				</div>
			)}
		</li>
	);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the select is passed in as children
		<label className="flex flex-col gap-1">
			<span className="font-medium text-ink-500 text-xs uppercase tracking-wide">
				{label}
			</span>
			{children}
		</label>
	);
}

function DeleteButton({
	file,
	fetcher,
}: {
	file: ManagedFile;
	fetcher: ReturnType<typeof useFetcher>;
}) {
	const [confirming, setConfirming] = useState(false);

	if (!confirming) {
		return (
			<button
				type="button"
				onClick={() => setConfirming(true)}
				className="rounded-lg px-3 py-1.5 text-ink-500 text-sm transition hover:bg-rose-500/10 hover:text-rose-400"
			>
				Delete
			</button>
		);
	}

	return (
		<div className="flex items-center gap-2">
			{/* Deletion destroys the bytes immediately, so it gets one deliberate confirmation. */}
			<span className="text-ink-400 text-xs">Delete for good?</span>
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
					fetcher.submit(null, {
						method: "post",
						action: `/app/files/${file.id}/delete`,
					})
				}
				className="rounded-lg bg-rose-500/90 px-3 py-1.5 font-medium text-sm text-white transition hover:bg-rose-500"
			>
				Delete
			</button>
		</div>
	);
}
