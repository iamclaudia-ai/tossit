/**
 * Which files the download page may show in place, and as what.
 *
 * `files.content_type` is the uploader's `File.type`, client-supplied and stored as-is, and the
 * filename is just as client-supplied, so this list is the only thing standing between a
 * mislabelled upload and the recipient's browser.
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
		// Apple's aliases from macOS's type table: Safari reports video/x-m4v for .m4v (Chrome says
		// video/mp4), and both Safari and Chrome report audio/x-m4a for .m4a (below).
		"video/x-m4v": "video",

		"audio/mpeg": "audio",
		"audio/mp4": "audio",
		"audio/x-m4a": "audio",
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

// For uploads that arrive without a real type: the CLI sends none, and browsers send "" or
// octet-stream for extensions they don't know. Every value must be a key of PREVIEWABLE.
const BY_EXTENSION = new Map<string, string>(
	Object.entries({
		mp4: "video/mp4",
		m4v: "video/mp4",
		webm: "video/webm",
		mov: "video/quicktime",
		mp3: "audio/mpeg",
		m4a: "audio/mp4",
		aac: "audio/aac",
		wav: "audio/wav",
		ogg: "audio/ogg",
		oga: "audio/ogg",
		opus: "audio/ogg",
		flac: "audio/flac",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		png: "image/png",
		gif: "image/gif",
		webp: "image/webp",
		avif: "image/avif",
	}),
);

const UNTYPED = new Set(["", "application/octet-stream", "binary/octet-stream"]);

/**
 * The preview for a stored file, or null when it is download-only. A real declared type always
 * wins; the filename's extension is consulted only when the upload carried no type at all.
 */
export function previewFor(
	contentType: string | null | undefined,
	filename: string,
): Preview | null {
	let mimeType = (contentType ?? "").split(";")[0].trim().toLowerCase();
	if (UNTYPED.has(mimeType)) {
		const extension = /\.([a-z0-9]+)$/.exec(filename.toLowerCase())?.[1];
		mimeType = (extension && BY_EXTENSION.get(extension)) || "";
	}
	const kind = PREVIEWABLE.get(mimeType);
	return kind ? { kind, mimeType } : null;
}
