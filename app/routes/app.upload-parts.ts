import { requireUser } from "~/lib/auth";
import { getR2Config, presignParts } from "~/lib/r2";
import { loadPendingUpload } from "~/lib/upload.server";
import type { Route } from "./+types/app.upload-parts";

/**
 * Re-presign specific parts. Presigned URLs live an hour; a genuinely large upload on a slow
 * connection outlives that, and restarting a 4 GB transfer because a signature aged out would
 * be absurd. Only the parts that need it are reissued.
 */
export async function action({ request, context }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const { user } = await requireUser(env, request);

	const body = (await request.json()) as {
		fileId?: string;
		partNumbers?: number[];
	};

	if (!body.fileId || !Array.isArray(body.partNumbers) || !body.partNumbers.length) {
		return Response.json(
			{ error: "fileId and partNumbers are required." },
			{ status: 400 },
		);
	}

	const file = await loadPendingUpload(env, body.fileId, { userId: user.id });
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
