import { AwsClient } from "aws4fetch";

/**
 * R2 over the S3 API — the ENTIRE multipart lifecycle lives here.
 *
 * ⚠️ Never call `env.BUCKET.createMultipartUpload()`. The uploadId returned by the R2 binding is
 * not valid for S3-API part uploads or completion, and the failure surfaces late and
 * confusingly. The binding is used only on the download path. See CLAUDE.md.
 */

/** S3 rule: every part except the last must be >= 5 MB. */
export const MIN_PART_SIZE = 5 * 1024 * 1024;
/** Below this, skip multipart entirely and use a single presigned PUT. */
export const SINGLE_PUT_MAX = MIN_PART_SIZE;
const TARGET_PART_SIZE = 16 * 1024 * 1024;
/** S3 caps a multipart upload at 10,000 parts. Leave headroom. */
const MAX_PARTS = 9_000;
/** Presigned URLs live for an hour; clients re-request parts via /upload-parts. */
export const PRESIGN_TTL_SECONDS = 3600;

export interface R2Config {
	accountId: string;
	accessKeyId: string;
	secretAccessKey: string;
	bucket: string;
	endpoint: string;
}

/**
 * Structural shape of the env this module needs. Deliberately not the global `Env` type, so
 * this file also compiles under plain Node for scripts/r2-roundtrip.ts.
 */
export interface R2Env {
	R2_ACCOUNT_ID: string;
	R2_ACCESS_KEY_ID: string;
	R2_SECRET_ACCESS_KEY: string;
	R2_BUCKET: string;
	R2_S3_ENDPOINT: string;
}

export function getR2Config(env: R2Env): R2Config {
	return {
		accountId: env.R2_ACCOUNT_ID,
		accessKeyId: env.R2_ACCESS_KEY_ID,
		secretAccessKey: env.R2_SECRET_ACCESS_KEY,
		bucket: env.R2_BUCKET,
		endpoint: env.R2_S3_ENDPOINT.replace(/\/$/, ""),
	};
}

function client(config: R2Config) {
	return new AwsClient({
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey,
		service: "s3",
		region: "auto",
	});
}

const objectUrl = (config: R2Config, key: string) =>
	`${config.endpoint}/${config.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;

/**
 * Part size for a given upload: at least 16 MB, scaled up so we never exceed MAX_PARTS.
 */
export function partSizeFor(totalBytes: number): number {
	return Math.max(TARGET_PART_SIZE, Math.ceil(totalBytes / MAX_PARTS));
}

export function partCountFor(totalBytes: number, partSize: number): number {
	return Math.max(1, Math.ceil(totalBytes / partSize));
}

async function parseXmlField(response: Response, field: string): Promise<string | null> {
	const body = await response.text();
	const match = body.match(new RegExp(`<${field}>([^<]+)</${field}>`));
	return match ? match[1] : null;
}

async function assertOk(response: Response, action: string): Promise<void> {
	if (response.ok) return;
	const body = await response.text().catch(() => "");
	throw new Error(`R2 ${action} failed (${response.status}): ${body.slice(0, 500)}`);
}

/** Presign a single PUT for small files (< 5 MB). */
export async function presignSinglePut(
	config: R2Config,
	key: string,
	contentType?: string,
): Promise<string> {
	const url = new URL(objectUrl(config, key));
	url.searchParams.set("X-Amz-Expires", String(PRESIGN_TTL_SECONDS));
	const signed = await client(config).sign(
		new Request(url, {
			method: "PUT",
			headers: contentType ? { "content-type": contentType } : undefined,
		}),
		{ aws: { signQuery: true } },
	);
	return signed.url;
}

export async function createMultipartUpload(
	config: R2Config,
	key: string,
	contentType?: string,
): Promise<string> {
	const url = `${objectUrl(config, key)}?uploads=`;
	const response = await client(config).fetch(url, {
		method: "POST",
		headers: contentType ? { "content-type": contentType } : undefined,
	});
	await assertOk(response, "createMultipartUpload");
	const uploadId = await parseXmlField(response, "UploadId");
	if (!uploadId) throw new Error("R2 createMultipartUpload returned no UploadId");
	return uploadId;
}

/** Presign PUT URLs for the given part numbers (1-indexed). */
export async function presignParts(
	config: R2Config,
	key: string,
	uploadId: string,
	partNumbers: number[],
): Promise<{ partNumber: number; url: string }[]> {
	const aws = client(config);
	return Promise.all(
		partNumbers.map(async (partNumber) => {
			const url = new URL(objectUrl(config, key));
			url.searchParams.set("partNumber", String(partNumber));
			url.searchParams.set("uploadId", uploadId);
			url.searchParams.set("X-Amz-Expires", String(PRESIGN_TTL_SECONDS));
			const signed = await aws.sign(new Request(url, { method: "PUT" }), {
				aws: { signQuery: true },
			});
			return { partNumber, url: signed.url };
		}),
	);
}

export async function completeMultipartUpload(
	config: R2Config,
	key: string,
	uploadId: string,
	parts: { partNumber: number; etag: string }[],
): Promise<void> {
	const body = [
		"<CompleteMultipartUpload>",
		...parts
			.slice()
			.sort((a, b) => a.partNumber - b.partNumber)
			.map(
				(part) =>
					`<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${escapeXml(part.etag)}</ETag></Part>`,
			),
		"</CompleteMultipartUpload>",
	].join("");

	const url = `${objectUrl(config, key)}?uploadId=${encodeURIComponent(uploadId)}`;
	const response = await client(config).fetch(url, {
		method: "POST",
		body,
		headers: { "content-type": "application/xml" },
	});
	await assertOk(response, "completeMultipartUpload");

	// S3 can return 200 with an <Error> body on completion. Treat that as a failure.
	const text = await response.text();
	if (text.includes("<Error>")) {
		throw new Error(
			`R2 completeMultipartUpload returned an error: ${text.slice(0, 500)}`,
		);
	}
}

export async function abortMultipartUpload(
	config: R2Config,
	key: string,
	uploadId: string,
): Promise<void> {
	const url = `${objectUrl(config, key)}?uploadId=${encodeURIComponent(uploadId)}`;
	const response = await client(config).fetch(url, { method: "DELETE" });
	// 404 means it's already gone — that's a successful abort as far as we're concerned.
	if (response.status !== 404) await assertOk(response, "abortMultipartUpload");
}

/** HEAD the object to get the size R2 actually stored (client-claimed size is not trusted). */
export async function headObject(
	config: R2Config,
	key: string,
): Promise<{ size: number; contentType: string | null } | null> {
	const response = await client(config).fetch(objectUrl(config, key), {
		method: "HEAD",
	});
	if (response.status === 404) return null;
	await assertOk(response, "headObject");
	return {
		size: Number(response.headers.get("content-length") ?? 0),
		contentType: response.headers.get("content-type"),
	};
}

export async function deleteObject(config: R2Config, key: string): Promise<void> {
	const response = await client(config).fetch(objectUrl(config, key), {
		method: "DELETE",
	});
	if (response.status !== 404) await assertOk(response, "deleteObject");
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * R2 object keys: `${fileId}/${sanitizedFilename}`. The id keeps keys unique; the filename is
 * kept only so the key is legible in the R2 dashboard. The name shown to a downloader always
 * comes from files.filename, never from the key.
 */
export function buildR2Key(fileId: string, filename: string): string {
	const safe = filename
		// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is the point
		.replace(/[\u0000-\u001f]/g, "")
		.replace(/[/\\?%*:|"<>]/g, "_")
		.slice(0, 200)
		.trim();
	return `${fileId}/${safe || "file"}`;
}

export interface R2Object {
	key: string;
	size: number;
	lastModified: number;
}

/**
 * Lists objects in the bucket, following continuation tokens.
 *
 * Only used by the nightly reconcile — the app never needs to enumerate storage, since the
 * database is the index.
 */
export async function listObjects(config: R2Config, limit = 5_000): Promise<R2Object[]> {
	const aws = client(config);
	const objects: R2Object[] = [];
	let token: string | null = null;

	do {
		const url = new URL(`${config.endpoint}/${config.bucket}`);
		url.searchParams.set("list-type", "2");
		url.searchParams.set("max-keys", "1000");
		if (token) url.searchParams.set("continuation-token", token);

		const response = await aws.fetch(url.toString());
		await assertOk(response, "listObjects");
		const xml = await response.text();

		for (const match of xml.matchAll(
			/<Contents>[\s\S]*?<Key>([^<]+)<\/Key>[\s\S]*?<LastModified>([^<]+)<\/LastModified>[\s\S]*?<Size>(\d+)<\/Size>[\s\S]*?<\/Contents>/g,
		)) {
			objects.push({
				key: match[1],
				lastModified: Date.parse(match[2]),
				size: Number(match[3]),
			});
			if (objects.length >= limit) return objects;
		}

		const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
		const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
		token = truncated && next ? next[1] : null;
	} while (token);

	return objects;
}
