import { nanoid } from "nanoid";
import { getDb } from "~/db";
import { files } from "~/db/schema";
import { requireUser } from "~/lib/auth";
import {
	buildR2Key,
	createMultipartUpload,
	getR2Config,
	partCountFor,
	partSizeFor,
	presignParts,
	presignSinglePut,
	SINGLE_PUT_MAX,
} from "~/lib/r2";
import { generateSlug } from "~/lib/tokens";
import { DEFAULT_EXPIRY_MS, type IntentInput, validateIntent } from "~/lib/upload.server";
import type { Route } from "./+types/app.upload-intent";

/**
 * Start an upload: reserve the row and the public slug, open the multipart upload on R2, and
 * hand back presigned PUT URLs. The Worker never sees a byte of the file.
 */
export async function action({ request, context }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const { user } = await requireUser(env, request);

	const input = (await request.json()) as Partial<IntentInput>;
	const invalid = validateIntent(input);
	if (invalid) return Response.json({ error: invalid }, { status: 400 });

	const { filename, size, contentType } = input as IntentInput;
	const fileId = nanoid();
	const slug = generateSlug();
	const r2Key = buildR2Key(fileId, filename);
	const config = getR2Config(env);
	const now = Date.now();

	// Small files skip multipart entirely — one presigned PUT, no completion dance.
	const isSingle = size <= SINGLE_PUT_MAX;
	const uploadId = isSingle
		? null
		: await createMultipartUpload(config, r2Key, contentType);

	await getDb(env)
		.insert(files)
		.values({
			id: fileId,
			slug,
			r2Key,
			filename,
			contentType: contentType ?? null,
			size: null, // set on completion, from what R2 actually stored
			status: "pending",
			multipartId: uploadId,
			uploadedBy: user.id,
			createdAt: now,
			expiresAt: now + DEFAULT_EXPIRY_MS,
		});

	if (isSingle) {
		// Presigned without a content-type so the browser is free to send whatever it likes;
		// signing the header would make any mismatch a signature failure. The type shown on
		// the download page comes from the database, not from R2 metadata.
		return Response.json({
			fileId,
			slug,
			single: { url: await presignSinglePut(config, r2Key) },
		});
	}

	const partSize = partSizeFor(size);
	const partCount = partCountFor(size, partSize);
	const parts = await presignParts(
		config,
		r2Key,
		uploadId as string,
		Array.from({ length: partCount }, (_, i) => i + 1),
	);

	return Response.json({ fileId, slug, uploadId, partSize, parts });
}
