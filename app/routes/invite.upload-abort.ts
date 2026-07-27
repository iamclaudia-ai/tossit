import { eq } from "drizzle-orm";
import { getDb } from "~/db";
import { files } from "~/db/schema";
import { resolveInvite } from "~/lib/invites.server";
import { abortMultipartUpload, deleteObject, getR2Config } from "~/lib/r2";
import { loadPendingUpload } from "~/lib/upload.server";
import type { Route } from "./+types/invite.upload-abort";

/** Cancel an anonymous upload. No invite use is burned, because none was consumed yet. */
export async function action({ params, request, context }: Route.ActionArgs) {
	const env = context.cloudflare.env;

	const resolution = await resolveInvite(env, params.code);
	// Abort stays permissive: cleaning up after a revoked or spent invite is still worth doing.
	const inviteId = resolution.ok ? resolution.invite.id : undefined;
	if (!inviteId) return Response.json({ ok: true });

	const body = (await request.json()) as { fileId?: string };
	if (!body.fileId) return Response.json({ ok: true });

	const file = await loadPendingUpload(env, body.fileId, { inviteId });
	if (!file) return Response.json({ ok: true });

	const config = getR2Config(env);
	if (file.multipartId) {
		await abortMultipartUpload(config, file.r2Key, file.multipartId).catch(() => {});
	} else {
		await deleteObject(config, file.r2Key).catch(() => {});
	}

	await getDb(env).delete(files).where(eq(files.id, file.id));
	return Response.json({ ok: true });
}
