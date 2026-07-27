import { resolveInvite } from "~/lib/invites.server";
import { getR2Config, presignParts } from "~/lib/r2";
import { loadPendingUpload } from "~/lib/upload.server";
import type { Route } from "./+types/invite.upload-parts";

/** Re-presign parts for an in-flight anonymous upload whose signatures aged out. */
export async function action({ params, request, context }: Route.ActionArgs) {
	const env = context.cloudflare.env;

	const resolution = await resolveInvite(env, params.code);
	if (!resolution.ok || resolution.invite.kind !== "upload") {
		return Response.json(
			{ error: "This upload link is no longer valid." },
			{ status: 404 },
		);
	}

	const body = (await request.json()) as { fileId?: string; partNumbers?: number[] };
	if (!body.fileId || !Array.isArray(body.partNumbers) || !body.partNumbers.length) {
		return Response.json(
			{ error: "fileId and partNumbers are required." },
			{ status: 400 },
		);
	}

	// Scoped to this invite, so one invite's code can't refresh another's upload.
	const file = await loadPendingUpload(env, body.fileId, {
		inviteId: resolution.invite.id,
	});
	if (!file?.multipartId) {
		return Response.json({ error: "No such upload in progress." }, { status: 404 });
	}

	const partNumbers = body.partNumbers
		.filter((n) => Number.isInteger(n) && n >= 1 && n <= 10_000)
		.slice(0, 1_000);

	const parts = await presignParts(
		getR2Config(env),
		file.r2Key,
		file.multipartId,
		partNumbers,
	);
	return Response.json({ parts });
}
