import { cloudflareContext } from "~/context";
import {
	contentDisposition,
	countView,
	parseRange,
	rangeNotSatisfiable,
	resolveDownloadable,
	shouldCountView,
	streamFile,
} from "~/lib/download.server";
import { previewFor } from "~/lib/preview";
import { checkRateLimit } from "~/lib/ratelimit.server";
import type { Route } from "./+types/download.view";

/**
 * The bytes behind the download page's player or image: R2 → Worker → browser, shown in place.
 *
 * It sits behind the same resolveDownloadable() gate as /raw, but it is not a download. It
 * counts views, never touches download_count, and never claims a slot under max_downloads,
 * so watching a capped link doesn't use it up. /raw stays the only way to a download.
 */
/**
 * Opened directly (say, "Open video in new tab"), a file can't run script or load anything but
 * itself. A bare `sandbox; default-src 'none'` is too tight: in Chrome the media document's
 * own <video> load is blocked by default-src, and a sandbox without allow-same-origin gives
 * the document an opaque origin, so that load fails CORS. allow-same-origin is only risky
 * together with allow-scripts, which stays off. Inline styles are the media document's
 * centering and dark background.
 */
const VIEW_CSP =
	"sandbox allow-same-origin; default-src 'none'; media-src 'self'; img-src 'self'; style-src 'unsafe-inline'";

export async function loader({ params, request, context }: Route.LoaderArgs) {
	const { env, ctx } = context.get(cloudflareContext);

	// Its own budget: scrubbing a video fires a ranged request per seek, and that shouldn't
	// eat into the same visitor's downloads.
	const limited = await checkRateLimit(env.DOWNLOAD_RATE, request, "v");
	if (limited) return limited;

	const resolution = await resolveDownloadable(env, params.slug);
	if (!resolution.ok) return notFound();

	const { file } = resolution;
	// content_type is the uploader's File.type. Only allowlisted media is ever served inline;
	// everything else, including a file merely claiming to be media, gets the same 404.
	const preview = previewFor(file.contentType, file.filename);
	if (!preview) return notFound();

	const range = parseRange(request.headers.get("range"), file.size ?? 0);
	if (range === "unsatisfiable") return rangeNotSatisfiable(file.size ?? 0);

	const response = await streamFile(env, request, file, range, {
		// The normalized allowlist entry, never the raw stored string.
		"content-type": preview.mimeType,
		"content-disposition": contentDisposition(file.filename, "inline"),
		"content-security-policy": VIEW_CSP,
	});
	if (!response) return notFound();

	// Counted only once R2 has the bytes, and off the response path.
	if (shouldCountView(request)) ctx.waitUntil(countView(env, file.id));
	return response;
}

function notFound(): Response {
	return new Response("Not found", {
		status: 404,
		headers: { "cache-control": "no-store" },
	});
}
