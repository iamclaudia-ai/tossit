import { nanoid } from "nanoid";
import { cloudflareContext } from "~/context";
import { getDb } from "~/db";
import { downloadEvents } from "~/db/schema";
import {
	contentDisposition,
	parseRange,
	rangeNotSatisfiable,
	reserveDownload,
	resolveDownloadable,
	shouldCountDownload,
	streamFile,
} from "~/lib/download.server";
import { checkRateLimit, hashIp } from "~/lib/ratelimit.server";
import type { Route } from "./+types/download.raw";

/**
 * Streams the file R2 → Worker → browser.
 *
 * Routing bytes through the Worker is what makes expiry, download caps, and revocation real
 * rather than decorative — a presigned download URL could not be taken back. There is no
 * response size cap on a streamed Worker response, and R2 egress is free.
 */
export async function loader({ params, request, context }: Route.LoaderArgs) {
	const env = context.get(cloudflareContext).env;

	const limited = await checkRateLimit(env.DOWNLOAD_RATE, request, "d");
	if (limited) return limited;

	const resolution = await resolveDownloadable(env, params.slug);
	// Deliberately uniform: the byte endpoint says nothing about *why* a link is unavailable.
	// The human-facing page at /d/:slug is where the distinction is drawn.
	if (!resolution.ok) return new Response("Not found", { status: 404 });

	const { file } = resolution;
	const range = parseRange(request.headers.get("range"), file.size ?? 0);
	if (range === "unsatisfiable") return rangeNotSatisfiable(file.size ?? 0);

	// Claim the slot before streaming. Doing it after would mean a cap of 1 could be beaten by
	// two simultaneous readers, and we cannot know whether a stream ran to completion anyway.
	if (shouldCountDownload(request)) {
		const claimed = await reserveDownload(env, file.id);
		if (!claimed) return new Response("Not found", { status: 404 });

		// Audit trail, written after the response is on its way so it never delays the stream.
		context.get(cloudflareContext).ctx.waitUntil(recordDownload(env, request, file.id));
	}

	const response = await streamFile(env, request, file, range, {
		"content-type": file.contentType || "application/octet-stream",
		"content-disposition": contentDisposition(file.filename),
	});
	return response ?? new Response("Not found", { status: 404 });
}

/**
 * One row per counted download. IPs are hashed, never stored raw — the question this answers
 * is "how many distinct people grabbed this", not "who".
 */
async function recordDownload(env: Env, request: Request, fileId: string): Promise<void> {
	try {
		await getDb(env)
			.insert(downloadEvents)
			.values({
				id: nanoid(),
				fileId,
				ipHash: await hashIp(env, request),
				userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
				createdAt: Date.now(),
			});
	} catch (error) {
		// Analytics must never break a download.
		console.error("download event failed:", (error as Error).message);
	}
}
