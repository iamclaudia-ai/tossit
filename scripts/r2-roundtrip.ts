/**
 * Proves a >200 MB file survives a full multipart round trip through the exact helpers the
 * app uses — a direct check of storage credentials, CORS, and the multipart lifecycle.
 *
 *   bun run scripts/r2-roundtrip.ts [sizeInMB]
 *
 * Reads credentials from .dev.vars. Uploads a random file in parallel parts using presigned
 * URLs, completes the multipart upload, verifies the stored size, downloads it back, and
 * compares SHA-256 end to end. Cleans up after itself.
 */

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import {
	abortMultipartUpload,
	buildR2Key,
	completeMultipartUpload,
	createMultipartUpload,
	deleteObject,
	headObject,
	partCountFor,
	partSizeFor,
	presignParts,
	type R2Config,
} from "../app/lib/r2";

const UPLOAD_CONCURRENCY = 4;

function loadDevVars(): Record<string, string> {
	let raw: string;
	try {
		raw = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
	} catch {
		console.error(
			"Missing .dev.vars — copy .dev.vars.example and fill in the R2 credentials.",
		);
		process.exit(1);
	}
	const vars: Record<string, string> = {};
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq === -1) continue;
		vars[trimmed.slice(0, eq).trim()] = trimmed
			.slice(eq + 1)
			.trim()
			.replace(/^["']|["']$/g, "");
	}
	return vars;
}

function requireVar(vars: Record<string, string>, key: string): string {
	const value = vars[key];
	if (!value) {
		console.error(`Missing ${key} in .dev.vars`);
		process.exit(1);
	}
	return value;
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let cursor = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (cursor < items.length) {
			const index = cursor++;
			results[index] = await fn(items[index], index);
		}
	});
	await Promise.all(workers);
	return results;
}

async function main() {
	const sizeMb = Number(process.argv[2] ?? 250);
	const totalBytes = Math.round(sizeMb * 1024 * 1024);

	const vars = loadDevVars();
	const config: R2Config = {
		accountId: requireVar(vars, "R2_ACCOUNT_ID"),
		accessKeyId: requireVar(vars, "R2_ACCESS_KEY_ID"),
		secretAccessKey: requireVar(vars, "R2_SECRET_ACCESS_KEY"),
		bucket: requireVar(vars, "R2_BUCKET"),
		endpoint: requireVar(vars, "R2_S3_ENDPOINT").replace(/\/$/, ""),
	};

	console.log(`Generating ${mb(totalBytes)} of random data...`);
	const payload = Buffer.alloc(totalBytes);
	// randomBytes caps out well below 250 MB, so fill in chunks.
	for (let offset = 0; offset < totalBytes; offset += 1 << 20) {
		randomBytes(Math.min(1 << 20, totalBytes - offset)).copy(payload, offset);
	}
	const sourceHash = createHash("sha256").update(payload).digest("hex");

	const key = buildR2Key(`roundtrip-${Date.now()}`, "roundtrip.bin");
	const partSize = partSizeFor(totalBytes);
	const partCount = partCountFor(totalBytes, partSize);
	console.log(`Key: ${key}`);
	console.log(`Parts: ${partCount} x ${mb(partSize)}, ${UPLOAD_CONCURRENCY} in flight`);

	const uploadId = await createMultipartUpload(config, key, "application/octet-stream");
	console.log(`uploadId: ${uploadId}`);

	try {
		const partNumbers = Array.from({ length: partCount }, (_, i) => i + 1);
		const urls = await presignParts(config, key, uploadId, partNumbers);
		console.log("Presigned all parts. Uploading...");

		const started = Date.now();
		let uploadedBytes = 0;

		const parts = await mapWithConcurrency(urls, UPLOAD_CONCURRENCY, async (part) => {
			const start = (part.partNumber - 1) * partSize;
			const chunk = payload.subarray(start, Math.min(start + partSize, totalBytes));
			const response = await fetch(part.url, { method: "PUT", body: chunk });
			if (!response.ok) {
				throw new Error(
					`part ${part.partNumber} failed (${response.status}): ${await response.text()}`,
				);
			}
			const etag = response.headers.get("etag");
			if (!etag) {
				throw new Error(
					`part ${part.partNumber} returned no ETag — check the bucket CORS ExposeHeaders config`,
				);
			}
			uploadedBytes += chunk.byteLength;
			process.stdout.write(
				`\r  ${((uploadedBytes / totalBytes) * 100).toFixed(1)}% (${mb(uploadedBytes)})   `,
			);
			return { partNumber: part.partNumber, etag };
		});

		const uploadSeconds = (Date.now() - started) / 1000;
		process.stdout.write("\n");
		console.log(
			`Uploaded in ${uploadSeconds.toFixed(1)}s (${mb(totalBytes / uploadSeconds)}/s)`,
		);

		await completeMultipartUpload(config, key, uploadId, parts);
		console.log("Multipart upload completed.");

		const head = await headObject(config, key);
		if (!head) throw new Error("HEAD returned 404 after completion");
		if (head.size !== totalBytes) {
			throw new Error(`size mismatch: stored ${head.size}, expected ${totalBytes}`);
		}
		console.log(`Stored size verified: ${mb(head.size)}`);

		console.log("Downloading it back...");
		const downloaded = await downloadObject(config, key);
		const downloadHash = createHash("sha256").update(downloaded).digest("hex");
		if (downloadHash !== sourceHash) {
			throw new Error(`hash mismatch\n  up:   ${sourceHash}\n  down: ${downloadHash}`);
		}
		console.log(`SHA-256 matches: ${downloadHash}`);

		console.log("\n✅ Round trip passed.");
	} catch (error) {
		console.error("\n❌ Round trip failed:", error);
		await abortMultipartUpload(config, key, uploadId).catch(() => {});
		process.exit(1);
	} finally {
		await deleteObject(config, key).catch(() => {});
	}
}

/** GET the object with a signed request (the bucket is private). */
async function downloadObject(config: R2Config, key: string): Promise<Buffer> {
	const { AwsClient } = await import("aws4fetch");
	const aws = new AwsClient({
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey,
		service: "s3",
		region: "auto",
	});
	const url = `${config.endpoint}/${config.bucket}/${key
		.split("/")
		.map(encodeURIComponent)
		.join("/")}`;
	const response = await aws.fetch(url);
	if (!response.ok) {
		throw new Error(`download failed (${response.status}): ${await response.text()}`);
	}
	return Buffer.from(await response.arrayBuffer());
}

main();
