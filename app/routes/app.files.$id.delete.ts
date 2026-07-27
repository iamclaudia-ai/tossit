import { eq } from "drizzle-orm";
import { getDb } from "~/db";
import { files } from "~/db/schema";
import { requireUser } from "~/lib/auth";
import { loadManageableFile } from "~/lib/files.server";
import { abortMultipartUpload, deleteObject, getR2Config } from "~/lib/r2";
import type { Route } from "./+types/app.files.$id.delete";

/**
 * Delete a file. The bytes go immediately — "delete" has to mean the link stops working and
 * the data is gone, not that it's hidden from a list. The row is kept as a tombstone so the
 * slug can never be reissued, and the daily cron reaps it later.
 */
export async function action({ params, request, context }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const authed = await requireUser(env, request);

	const file = await loadManageableFile(env, params.id, authed);
	if (!file) return Response.json({ error: "Not found." }, { status: 404 });

	const config = getR2Config(env);

	// A half-finished upload has parts in flight rather than an object; those are billable
	// until explicitly aborted.
	if (file.status === "pending" && file.multipartId) {
		await abortMultipartUpload(config, file.r2Key, file.multipartId).catch(() => {});
	}
	await deleteObject(config, file.r2Key).catch(() => {});

	await getDb(env)
		.update(files)
		.set({ deletedAt: Date.now(), status: "aborted" })
		.where(eq(files.id, file.id));

	return Response.json({ ok: true });
}
