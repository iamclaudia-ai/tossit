import { useCallback, useEffect, useRef, useState } from "react";
import { data } from "react-router";
import { Logo, Signature } from "~/components/brand";
import { cloudflareContext } from "~/context";
import { type DownloadRejection, resolveDownloadable } from "~/lib/download.server";
import { formatBytes, formatExpiry } from "~/lib/format";
import { type PreviewKind, previewFor } from "~/lib/preview";
import type { Route } from "./+types/download";

export function meta({ loaderData: loaded }: Route.MetaArgs) {
	return [
		{
			title: loaded?.file
				? `${loaded.file.filename} — tossit`
				: "Link unavailable — tossit",
		},
		// Belt and braces with the X-Robots-Tag header below: a pasted link must not be indexed.
		{ name: "robots", content: "noindex, nofollow" },
	];
}

export const headers: Route.HeadersFunction = () => ({
	"x-robots-tag": "noindex, nofollow",
	"cache-control": "private, no-store",
});

export async function loader({ params, context }: Route.LoaderArgs) {
	const resolution = await resolveDownloadable(
		context.get(cloudflareContext).env,
		params.slug,
	);

	if (!resolution.ok) {
		// Whoever opened this already holds the slug, so naming the reason leaks nothing they
		// don't have — and "this link expired" beats a bare 404 when they need to ask for a
		// fresh one.
		return data(
			{ file: null, reason: resolution.reason },
			{ status: resolution.reason === "missing" ? 404 : 410 },
		);
	}

	const { file } = resolution;
	return {
		file: {
			filename: file.filename,
			size: file.size,
			contentType: file.contentType,
			// What /d/:slug/view will serve inline, or null for download-only files.
			preview: previewFor(file.contentType, file.filename)?.kind ?? null,
			expiresAt: file.expiresAt,
			remaining:
				file.maxDownloads === null ? null : file.maxDownloads - file.downloadCount,
		},
		reason: null,
	};
}

export default function Download({ loaderData, params }: Route.ComponentProps) {
	if (!loaderData.file) {
		return <Unavailable reason={loaderData.reason as DownloadRejection} />;
	}

	return <Shared file={loaderData.file} slug={params.slug} />;
}

type SharedFile = NonNullable<Route.ComponentProps["loaderData"]["file"]>;

function Shared({ file, slug }: { file: SharedFile; slug: string }) {
	const { filename, size, expiresAt, remaining, preview } = file;
	// Flips when the browser can't decode the file (an unsupported codec, or a type that lied),
	// which puts back the plain download card.
	const [failed, setFailed] = useState(false);
	const fail = useCallback(() => setFailed(true), []);
	const kind = failed ? null : preview;
	const visual = kind === "video" || kind === "image";
	const src = `/d/${slug}/view`;

	return (
		<main className="flex min-h-dvh flex-col items-center px-4">
			<div
				className={`flex w-full flex-1 flex-col justify-center py-12 ${visual ? "max-w-2xl" : "max-w-md"}`}
			>
				<p className="text-center">
					<Logo arrive />
				</p>

				<div
					className={`mt-6 rounded-3xl border border-line/60 bg-white/75 text-center shadow-soft backdrop-blur-sm ${visual ? "p-3 pb-8 sm:p-4 sm:pb-8" : "p-8"}`}
				>
					{visual ? (
						<Preview kind={kind} src={src} filename={filename} onFail={fail} />
					) : (
						<FileGlyph kind={kind} />
					)}

					<div className={visual ? "px-5" : undefined}>
						<p className="mt-5 flex items-center justify-center gap-2 text-faint text-xs uppercase tracking-[0.2em]">
							<HeartIcon />
							Tossed your way
						</p>
						{/* wrap-anywhere: whole words move to the next line, and only an unbroken long name splits */}
						<h1 className="mt-2 wrap-anywhere font-display text-2xl text-ink leading-snug">
							{filename}
						</h1>
						<p className="tnum mt-1 font-mono text-muted text-sm">{formatBytes(size)}</p>

						{kind === "audio" && (
							<Preview kind="audio" src={src} filename={filename} onFail={fail} />
						)}

						<a
							href={`/d/${slug}/raw`}
							// No JS in the way: a plain link the browser downloads, so resuming works.
							className={`mt-7 block w-full rounded-full bg-signature px-5 py-3.5 font-medium text-white no-underline shadow-soft transition hover:shadow-lift hover:brightness-105 ${visual ? "mx-auto sm:max-w-xs" : ""}`}
						>
							Download
						</a>

						<p className="mt-4 text-muted text-xs">
							{formatExpiry(expiresAt)}
							{remaining !== null &&
								` · ${remaining} download${remaining === 1 ? "" : "s"} left`}
						</p>
					</div>
				</div>

				<p className="mx-auto mt-6 max-w-sm text-center text-muted text-xs leading-relaxed">
					Shared with you via tossit. Files are not scanned for viruses — only open what
					you were expecting.
				</p>
			</div>
			<Signature />
		</main>
	);
}

/**
 * The browser's own player or an <img>, fed by /d/:slug/view (which counts views, never
 * downloads). On any decode or load error it calls onFail and the page falls back to the
 * download card.
 */
function Preview({
	kind,
	src,
	filename,
	onFail,
}: {
	kind: PreviewKind;
	src: string;
	filename: string;
	onFail: () => void;
}) {
	const ref = useRef<HTMLVideoElement & HTMLAudioElement & HTMLImageElement>(null);

	// The page is server-rendered, so the element can fail before hydration attaches onError.
	// Catch that case once on mount.
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const brokenImage = kind === "image" && el.complete && el.naturalWidth === 0;
		const brokenMedia = kind !== "image" && el.error !== null;
		if (brokenImage || brokenMedia) onFail();
	}, [kind, onFail]);

	if (kind === "image") {
		return (
			<div className="flex justify-center overflow-hidden rounded-2xl bg-violet-50/70 ring-1 ring-violet-200/50">
				<img
					ref={ref}
					src={src}
					alt={filename}
					onError={onFail}
					className="max-h-[70vh] w-auto max-w-full object-contain"
				/>
			</div>
		);
	}

	if (kind === "video") {
		return (
			<div className="overflow-hidden rounded-2xl bg-stone-950 ring-1 ring-stone-900/10">
				{/* biome-ignore lint/a11y/useMediaCaption: shared personal videos have no caption track */}
				<video
					ref={ref}
					src={src}
					controls
					playsInline
					preload="metadata"
					onError={onFail}
					className="mx-auto block max-h-[70vh] w-full"
				/>
			</div>
		);
	}

	return (
		// biome-ignore lint/a11y/useMediaCaption: shared personal audio has no caption track
		<audio
			ref={ref}
			src={src}
			controls
			preload="metadata"
			onError={onFail}
			className="mt-6 w-full"
		/>
	);
}

const MESSAGES: Record<DownloadRejection, { title: string; body: string }> = {
	missing: {
		title: "This link doesn't exist",
		body: "It may have been deleted, or the address might be slightly off.",
	},
	expired: {
		title: "This link has expired",
		body: "Links stop working after their expiry date. Ask the sender for a new one.",
	},
	exhausted: {
		title: "This link is used up",
		body: "It had a download limit and has reached it. Ask the sender for a new one.",
	},
};

function Unavailable({ reason }: { reason: DownloadRejection }) {
	const { title, body } = MESSAGES[reason] ?? MESSAGES.missing;
	return (
		<main className="flex min-h-dvh flex-col items-center px-4">
			<div className="flex w-full max-w-sm flex-1 flex-col justify-center py-16 text-center">
				<p>
					<Logo arrive />
				</p>
				<h1 className="mt-6 font-display text-3xl text-ink tracking-tight">{title}</h1>
				<p className="mt-3 text-balance font-display text-muted italic leading-relaxed">
					{body}
				</p>
			</div>
			<Signature />
		</main>
	);
}

function HeartIcon() {
	return (
		<svg viewBox="0 0 24 24" className="size-3 fill-rose-300" aria-hidden="true">
			<title>Love</title>
			<path d="M12 21s-7.5-4.6-10-9.3C.4 8.4 2.3 4 6.4 4c2.3 0 3.9 1.3 5.6 3.4C13.7 5.3 15.3 4 17.6 4 21.7 4 23.6 8.4 22 11.7 19.5 16.4 12 21 12 21z" />
		</svg>
	);
}

function FileGlyph({ kind }: { kind: PreviewKind | null }) {
	const audio = kind === "audio";
	return (
		<div
			className={`mx-auto flex size-20 items-center justify-center rounded-3xl shadow-soft ring-1 ${
				audio ? "bg-rose-100 ring-rose-200/70" : "bg-violet-100 ring-violet-200/70"
			}`}
		>
			{audio ? <MusicNote /> : <FileArrow />}
		</div>
	);
}

function MusicNote() {
	return (
		<svg
			width="36"
			height="36"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className="text-rose-500"
		>
			<title>Audio</title>
			<path d="M9 18V5l12-2v13" />
			<circle cx="6" cy="18" r="3" />
			<circle cx="18" cy="16" r="3" />
		</svg>
	);
}

function FileArrow() {
	return (
		<svg
			width="40"
			height="40"
			viewBox="0 0 48 48"
			fill="none"
			aria-hidden="true"
			className="text-violet-600"
		>
			<title>File</title>
			<path
				d="M14 6h13l9 9v27a1 1 0 0 1-1 1H14a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z"
				stroke="currentColor"
				strokeWidth="1.5"
				opacity="0.5"
			/>
			<path d="M27 6v9h9" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
			<path
				d="M24 22v13m0 0 5-5m-5 5-5-5"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
