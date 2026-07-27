import { sql } from "drizzle-orm";
import { getDb } from "~/db";
import type { FileRow } from "~/db/schema";

/**
 * The single gate in front of both /d/:slug and /d/:slug/raw — PLAN.md §7.
 *
 * A slug exists from the moment an upload starts, so pending and aborted rows are reachable
 * URLs. Every reason a link should not resolve is checked here, in one place, so the page and
 * the byte stream can never disagree about whether a file is available.
 */

export type DownloadRejection = "missing" | "expired" | "exhausted";

export type DownloadResolution =
	| { ok: true; file: FileRow }
	| { ok: false; reason: DownloadRejection };

export async function resolveDownloadable(
	env: Env,
	slug: string,
): Promise<DownloadResolution> {
	const db = getDb(env);
	const file = await db.query.files.findFirst({
		where: (files, { eq }) => eq(files.slug, slug),
	});

	// Never existed, still uploading, aborted, or deleted — all indistinguishable to a caller.
	if (file?.status !== "complete" || file.deletedAt !== null) {
		return { ok: false, reason: "missing" };
	}
	if (file.expiresAt !== null && file.expiresAt <= Date.now()) {
		return { ok: false, reason: "expired" };
	}
	if (file.maxDownloads !== null && file.downloadCount >= file.maxDownloads) {
		return { ok: false, reason: "exhausted" };
	}
	return { ok: true, file };
}

/**
 * Claims one download slot. The guard lives in the WHERE clause so two people clicking the
 * last download of a capped link can't both win — a read-then-write races straight past
 * max_downloads.
 *
 * Returns false when the slot could not be claimed.
 */
export async function reserveDownload(env: Env, fileId: string): Promise<boolean> {
	const result = await getDb(env).run(sql`
		update files
		   set download_count = download_count + 1
		 where id = ${fileId}
		   and status = 'complete'
		   and deleted_at is null
		   and (max_downloads is null or download_count < max_downloads)
	`);
	return (result.meta?.changes ?? 0) > 0;
}

/**
 * Whether this request should count as a download.
 *
 * A resumed download or a media player scrubbing a video fires many ranged GETs for what a
 * human would call one download, so only an opening request counts. HEAD never counts — link
 * previewers and curl -I would otherwise burn a capped link without anyone seeing the file.
 */
export function shouldCountDownload(request: Request): boolean {
	if (request.method !== "GET") return false;
	const range = request.headers.get("range");
	if (!range) return true;
	return /^bytes=0-/i.test(range.trim());
}

export interface ParsedRange {
	offset: number;
	length: number;
}

/**
 * Parses a single-range `Range` header against a known size.
 * Returns null for "no range", or "unsatisfiable" when the range falls outside the file.
 */
export function parseRange(
	header: string | null,
	size: number,
): ParsedRange | null | "unsatisfiable" {
	if (!header) return null;

	const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
	if (!match) return null; // multi-range and malformed headers fall back to the whole file

	const [, rawStart, rawEnd] = match;
	if (rawStart === "" && rawEnd === "") return null;

	let start: number;
	let end: number;

	if (rawStart === "") {
		// bytes=-N — the final N bytes.
		const suffix = Number(rawEnd);
		if (suffix <= 0) return "unsatisfiable";
		start = Math.max(0, size - suffix);
		end = size - 1;
	} else {
		start = Number(rawStart);
		end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
	}

	if (start >= size || start > end) return "unsatisfiable";
	return { offset: start, length: end - start + 1 };
}

/**
 * Content-Disposition that survives non-ASCII filenames. Browsers that understand RFC 5987
 * read filename*; the quoted ASCII fallback keeps the rest from saving "download".
 */
export function contentDisposition(filename: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is the point
	const clean = filename.replace(/[\u0000-\u001f]/g, "").replace(/"/g, "'");
	const ascii = clean.replace(/[^\x20-\x7e]/g, "_") || "download";
	return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}
