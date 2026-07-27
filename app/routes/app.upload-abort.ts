import { eq } from "drizzle-orm";
import { getDb } from "~/db";
import { files } from "~/db/schema";
import { requireUser } from "~/lib/auth";
import { abortMultipartUpload, deleteObject, getR2Config } from "~/lib/r2";
import { loadPendingUpload } from "~/lib/upload.server";
import type { Route } from "./+types/app.upload-abort";

/**
 * Cancel an upload. Aborting the multipart upload matters: R2 bills for orphaned parts, and a
 * cancelled 4 GB transfer that leaves its parts behind is a silent recurring charge.
 */
export async function action({ request, context }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const { user } = await requireUser(env, request);

	const body = (await request.json()) as { fileId?: string };
	if (!body.fileId) {
		return Response.json({ error: "fileId is required." }, { status: 400 });
	}

	const file = await loadPendingUpload(env, body.fileId, { userId: user.id });
	// Already gone is a successful abort as far as the caller is concerned.
	if (!file) return Response.json({ ok: true });

	const config = getR2Config(env);
	if (file.multipartId) {
		await abortMultipartUpload(config, file.r2Key, file.multipartId).catch(() => {});
	} else {
		// A single-PUT upload may have completed on R2 even though the client gave up.
		await deleteObject(config, file.r2Key).catch(() => {});
	}

	await getDb(env).delete(files).where(eq(files.id, file.id));
	return Response.json({ ok: true });
}
