/**
 * Which files the download page may show in place, and as what.
 *
 * `files.content_type` is the uploader's `File.type`, client-supplied and stored as-is, so this
 * list is the only thing standing between a mislabelled upload and the recipient's browser.
 * Keep it to formats a browser decodes as inert media. Never add SVG, HTML, XHTML, XML or
 * anything else that can carry script.
 */

export type PreviewKind = "video" | "audio" | "image";

// A Map, not an object literal: "constructor" or "__proto__" must not resolve to anything.
const PREVIEWABLE = new Map<string, PreviewKind>(
	Object.entries({
		"video/mp4": "video",
		"video/webm": "video",
		// iPhone .mov. Safari plays it, Chrome plays H.264 but not HEVC, and the page falls back to
		// the plain download card when the browser can't decode it.
		"video/quicktime": "video",

		"audio/mpeg": "audio",
		"audio/mp4": "audio",
		"audio/aac": "audio",
		"audio/wav": "audio",
		"audio/x-wav": "audio",
		"audio/ogg": "audio",
		"audio/flac": "audio",

		"image/jpeg": "image",
		"image/png": "image",
		"image/gif": "image",
		"image/webp": "image",
		"image/avif": "image",
	} satisfies Record<string, PreviewKind>),
);

export interface Preview {
	kind: PreviewKind;
	/** The normalized type from the allowlist, safe to send as Content-Type. */
	mimeType: string;
}

/** The preview for a stored content type, or null when the file is download-only. */
export function previewFor(contentType: string | null | undefined): Preview | null {
	if (!contentType) return null;
	const mimeType = contentType.split(";")[0].trim().toLowerCase();
	const kind = PREVIEWABLE.get(mimeType);
	return kind ? { kind, mimeType } : null;
}
