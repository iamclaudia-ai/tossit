import { data } from "react-router";
import { type DownloadRejection, resolveDownloadable } from "~/lib/download.server";
import { formatBytes, formatExpiry } from "~/lib/format";
import type { Route } from "./+types/download";

export function meta({ data: loaded }: Route.MetaArgs) {
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
	const resolution = await resolveDownloadable(context.cloudflare.env, params.slug);

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
		<main className="flex min-h-dvh flex-col items-center justify-center px-6 py-16">
			<div className="w-full max-w-md">
				<p className="text-center font-semibold text-ink-500 text-sm tracking-tight">
					toss<span className="text-accent">it</span>
				</p>

				<div className="mt-6 rounded-2xl border border-ink-850 bg-ink-900/60 p-8 text-center">
					<FileGlyph />

					{/* break-all so a long filename can't push the card sideways on a phone */}
					<h1 className="mt-5 break-all font-medium text-lg leading-snug">{filename}</h1>
					<p className="tnum mt-1 font-mono text-ink-500 text-sm">{formatBytes(size)}</p>

					<a
						href={`/d/${params.slug}/raw`}
						// No JS in the way: a plain link the browser downloads, so resuming works.
						className="mt-7 block w-full rounded-xl bg-accent px-5 py-3.5 font-medium text-white transition hover:bg-accent-bright"
					>
						Download
					</a>

					<p className="mt-4 text-ink-500 text-xs">
						{formatExpiry(expiresAt)}
						{remaining !== null &&
							` · ${remaining} download${remaining === 1 ? "" : "s"} left`}
					</p>
				</div>

				<p className="mt-6 text-center text-ink-700 text-xs leading-relaxed">
					Shared with you via tossit. Files are not scanned for viruses — only open what
					you were expecting.
				</p>
			</div>
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
		<main className="flex min-h-dvh flex-col items-center justify-center px-6">
			<div className="w-full max-w-sm text-center">
				<p className="font-semibold text-ink-500 text-sm tracking-tight">
					toss<span className="text-accent">it</span>
				</p>
				<h1 className="mt-6 font-medium text-xl tracking-tight">{title}</h1>
				<p className="mt-2 text-balance text-ink-500 text-sm leading-relaxed">{body}</p>
			</div>
		</main>
	);
}

function FileGlyph() {
	return (
		<svg
			width="40"
			height="40"
			viewBox="0 0 48 48"
			fill="none"
			aria-hidden="true"
			className="mx-auto text-accent"
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
