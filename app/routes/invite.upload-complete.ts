import { eq } from "drizzle-orm";
import { getDb } from "~/db";
import { files } from "~/db/schema";
import { consumeInviteUse, resolveInvite } from "~/lib/invites.server";
import {
	abortMultipartUpload,
	completeMultipartUpload,
	deleteObject,
	getR2Config,
	headObject,
} from "~/lib/r2";
import { loadPendingUpload, MAX_FILE_BYTES } from "~/lib/upload.server";
import type { Route } from "./+types/invite.upload-complete";

/**
 * Finish an anonymous upload and burn one use of the invite.
 *
 * The use is consumed here rather than at intent so a cancelled upload doesn't waste it, and
 * it's consumed *before* the row is marked complete so two simultaneous uploads can't both
 * satisfy a single-use invite.
 */
export async function action({ params, request, context }: Route.ActionArgs) {
	const env = context.cloudflare.env;

	const resolution = await resolveInvite(env, params.code);
	if (!resolution.ok || resolution.invite.kind !== "upload") {
		return Response.json(
			{ error: "This upload link is no longer valid." },
			{ status: 404 },
		);
	}
	const { invite } = resolution;

	const body = (await request.json()) as {
		fileId?: string;
		parts?: { partNumber: number; etag: string }[];
	};
	if (!body.fileId) {
		return Response.json({ error: "fileId is required." }, { status: 400 });
	}

	const file = await loadPendingUpload(env, body.fileId, { inviteId: invite.id });
	if (!file) {
		return Response.json({ error: "No such upload in progress." }, { status: 404 });
	}

	const config = getR2Config(env);
	const db = getDb(env);

	const claimed = await consumeInviteUse(env, invite.id);
	if (!claimed) {
		// Someone else finished an upload first and took the last use.
		if (file.multipartId) {
			await abortMultipartUpload(config, file.r2Key, file.multipartId).catch(() => {});
		}
		await db.update(files).set({ status: "aborted" }).where(eq(files.id, file.id));
		return Response.json({ error: "This upload link has been used." }, { status: 409 });
	}

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

	// No link is returned: the uploader is sending a file *to* the owner, and handing an
	// anonymous stranger a public download URL for it is not part of that deal.
	return Response.json({ ok: true, filename: file.filename, size: head.size });
}
