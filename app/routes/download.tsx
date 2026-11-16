import { data } from "react-router";
import { Signature, Wordmark } from "~/components/brand";
import { cloudflareContext } from "~/context";
import { type DownloadRejection, resolveDownloadable } from "~/lib/download.server";
import { formatBytes, formatExpiry } from "~/lib/format";
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

	const { filename, size, expiresAt, remaining } = loaderData.file;

	return (
		<main className="flex min-h-dvh flex-col items-center px-4">
			<div className="flex w-full max-w-md flex-1 flex-col justify-center py-12">
				<p className="text-center">
					<Wordmark />
				</p>

				<div className="mt-6 rounded-3xl border border-line/60 bg-white/75 p-8 text-center shadow-soft backdrop-blur-sm">
					<FileGlyph />

					<p className="mt-5 flex items-center justify-center gap-2 text-faint text-xs uppercase tracking-[0.2em]">
						<HeartIcon />
						Tossed your way
					</p>
					{/* break-all so a long filename can't push the card sideways on a phone */}
					<h1 className="mt-2 break-all font-display text-2xl text-ink leading-snug">
						{filename}
					</h1>
					<p className="tnum mt-1 font-mono text-muted text-sm">{formatBytes(size)}</p>

					<a
						href={`/d/${params.slug}/raw`}
						// No JS in the way: a plain link the browser downloads, so resuming works.
						className="mt-7 block w-full rounded-full bg-signature px-5 py-3.5 font-medium text-white no-underline shadow-soft transition hover:shadow-lift hover:brightness-105"
					>
						Download
					</a>

					<p className="mt-4 text-muted text-xs">
						{formatExpiry(expiresAt)}
						{remaining !== null &&
							` · ${remaining} download${remaining === 1 ? "" : "s"} left`}
					</p>
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
					<Wordmark />
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

function FileGlyph() {
	return (
		<div className="mx-auto flex size-20 items-center justify-center rounded-3xl bg-violet-100 shadow-soft ring-1 ring-violet-200/70">
			<FileArrow />
		</div>
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
