import { eq } from "drizzle-orm";
import { getDb } from "~/db";
import { files } from "~/db/schema";
import { requireUser } from "~/lib/auth";
import { getRequestOrigin } from "~/lib/origin";
import {
	abortMultipartUpload,
	completeMultipartUpload,
	deleteObject,
	getR2Config,
	headObject,
} from "~/lib/r2";
import { loadPendingUpload, MAX_FILE_BYTES } from "~/lib/upload.server";
import type { Route } from "./+types/app.upload-complete";

/**
 * Finish an upload: stitch the parts together, then trust R2 — not the client — for the size.
 */
export async function action({ request, context }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const { user } = await requireUser(env, request);

	const body = (await request.json()) as {
		fileId?: string;
		parts?: { partNumber: number; etag: string }[];
	};

	if (!body.fileId) {
		return Response.json({ error: "fileId is required." }, { status: 400 });
	}

	const file = await loadPendingUpload(env, body.fileId, { userId: user.id });
	if (!file) {
		return Response.json({ error: "No such upload in progress." }, { status: 404 });
	}

	const config = getR2Config(env);
	const db = getDb(env);

	if (file.multipartId) {
		if (!body.parts?.length) {
			return Response.json({ error: "parts are required." }, { status: 400 });
		}
		try {
			await completeMultipartUpload(config, file.r2Key, file.multipartId, body.parts);
		} catch (error) {
			await abortMultipartUpload(config, file.r2Key, file.multipartId).catch(() => {});
			await db.update(files).set({ status: "aborted" }).where(eq(files.id, file.id));
			return Response.json({ error: (error as Error).message }, { status: 400 });
		}
	}

	// The size claimed at intent time was never trustworthy — it came from the browser. Ask R2
	// what it actually stored, and refuse anything that slipped past the cap.
	const head = await headObject(config, file.r2Key);
	if (!head) {
		await db.update(files).set({ status: "aborted" }).where(eq(files.id, file.id));
		return Response.json(
			{ error: "The upload did not land in storage." },
			{ status: 400 },
		);
	}

	if (head.size > MAX_FILE_BYTES) {
		await deleteObject(config, file.r2Key).catch(() => {});
		await db.update(files).set({ status: "aborted" }).where(eq(files.id, file.id));
		return Response.json({ error: "That file is larger than 5 GB." }, { status: 400 });
	}

	await db
		.update(files)
		.set({
			status: "complete",
			size: head.size,
			multipartId: null,
			completedAt: Date.now(),
		})
		.where(eq(files.id, file.id));

	return Response.json({
		fileId: file.id,
		slug: file.slug,
		filename: file.filename,
		size: head.size,
		// Built from the origin the browser is actually on, so links copied in dev point at the
		// dev host instead of production.
		url: `${getRequestOrigin(request)}/d/${file.slug}`,
		expiresAt: file.expiresAt,
	});
}
