import { nanoid } from "nanoid";
import { getDb } from "~/db";
import { files } from "~/db/schema";
import { resolveInvite } from "~/lib/invites.server";
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
import type { Route } from "./+types/invite.upload-intent";

/**
 * Anonymous upload against an 'upload' invite. Same machinery as the signed-in path; the
 * invite code stands in for a session.
 *
 * The invite is NOT consumed here — a cancelled or failed upload must not burn it. That
 * happens on completion.
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

	const input = (await request.json()) as Partial<IntentInput>;
	const invalid = validateIntent(input);
	if (invalid) return Response.json({ error: invalid }, { status: 400 });

	const { filename, size, contentType } = input as IntentInput;
	const fileId = nanoid();
	const slug = generateSlug();
	const r2Key = buildR2Key(fileId, filename);
	const config = getR2Config(env);
	const now = Date.now();

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
			size: null,
			status: "pending",
			multipartId: uploadId,
			// No user: an upload invite deliberately requires no account.
			uploadedBy: null,
			inviteId: invite.id,
			createdAt: now,
			expiresAt: now + DEFAULT_EXPIRY_MS,
		});

	if (isSingle) {
		return Response.json({
			fileId,
			slug,
			single: { url: await presignSinglePut(config, r2Key) },
		});
	}

	const partSize = partSizeFor(size);
	const parts = await presignParts(
		config,
		r2Key,
		uploadId as string,
		Array.from({ length: partCountFor(size, partSize) }, (_, i) => i + 1),
	);

	return Response.json({ fileId, slug, uploadId, partSize, parts });
}
