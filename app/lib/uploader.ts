/**
 * Browser upload engine: intent → parallel presigned PUTs → complete.
 *
 * XMLHttpRequest rather than fetch, because fetch still has no upload progress event in any
 * shipping browser and this app is all about files big enough that progress matters.
 */

const CONCURRENCY = 4;

export interface UploadProgress {
	/** 0..1 across the whole file. */
	fraction: number;
	loaded: number;
	total: number;
	/** Bytes per second, smoothed. Null until there's enough signal. */
	bytesPerSecond: number | null;
	/** Seconds remaining, or null while unknown. */
	etaSeconds: number | null;
}

export interface UploadResult {
	fileId: string;
	slug: string;
	filename: string;
	size: number;
	url: string;
	expiresAt: number | null;
}

interface IntentResponse {
	fileId: string;
	slug: string;
	uploadId?: string;
	partSize?: number;
	parts?: { partNumber: number; url: string }[];
	single?: { url: string };
}

export class UploadCancelled extends Error {
	constructor() {
		super("Upload cancelled.");
		this.name = "UploadCancelled";
	}
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
	const response = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
		signal,
	});
	const data = (await response.json()) as Record<string, unknown>;
	if (!response.ok) throw new Error((data.error as string) ?? "Upload failed.");
	return data as T;
}

/** One presigned PUT with progress reporting. Resolves to the part's ETag. */
function putWithProgress(
	url: string,
	body: Blob,
	onBytes: (loaded: number) => void,
	signal: AbortSignal,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("PUT", url);

		xhr.upload.onprogress = (event) => onBytes(event.loaded);

		xhr.onload = () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				const etag = xhr.getResponseHeader("ETag");
				if (!etag) {
					// Almost always a missing ExposeHeaders: ETag on the bucket CORS policy.
					reject(new Error("No ETag returned — check the bucket CORS configuration."));
					return;
				}
				// Count the part as fully sent; onprogress can stop just short of the total.
				onBytes(body.size);
				resolve(etag);
			} else if (xhr.status === 403) {
				reject(new PresignExpired());
			} else {
				reject(new Error(`Upload failed with status ${xhr.status}.`));
			}
		};

		xhr.onerror = () => reject(new Error("Network error during upload."));
		xhr.onabort = () => reject(new UploadCancelled());

		signal.addEventListener("abort", () => xhr.abort(), { once: true });
		if (signal.aborted) {
			xhr.abort();
			return;
		}

		xhr.send(body);
	});
}

class PresignExpired extends Error {
	constructor() {
		super("Presigned URL expired.");
		this.name = "PresignExpired";
	}
}

/** Smooths instantaneous rate so the ETA doesn't jitter with every progress event. */
function createRateMeter() {
	const startedAt = Date.now();
	let smoothed: number | null = null;

	return (
		loaded: number,
		total: number,
	): Pick<UploadProgress, "bytesPerSecond" | "etaSeconds"> => {
		const elapsed = (Date.now() - startedAt) / 1000;
		if (elapsed < 0.5 || loaded === 0) return { bytesPerSecond: null, etaSeconds: null };

		const instant = loaded / elapsed;
		smoothed = smoothed === null ? instant : smoothed * 0.7 + instant * 0.3;
		const remaining = Math.max(0, total - loaded);
		return {
			bytesPerSecond: smoothed,
			etaSeconds: smoothed > 0 ? remaining / smoothed : null,
		};
	};
}

async function runWithConcurrency<T>(
	items: T[],
	limit: number,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	let cursor = 0;
	const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (cursor < items.length) {
			await worker(items[cursor++]);
		}
	});
	await Promise.all(runners);
}

export interface UploadOptions {
	onProgress?: (progress: UploadProgress) => void;
	signal: AbortSignal;
	/** Endpoint prefix — "/app" for the owner, "/i/<code>" for anonymous invite uploads. */
	basePath?: string;
}

export async function uploadFile(
	file: File,
	{ onProgress, signal, basePath = "/app" }: UploadOptions,
): Promise<UploadResult> {
	const intent = await postJson<IntentResponse>(
		`${basePath}/upload-intent`,
		{ filename: file.name, size: file.size, contentType: file.type || undefined },
		signal,
	);

	const meter = createRateMeter();
	const report = (loaded: number) => {
		onProgress?.({
			fraction: file.size ? Math.min(1, loaded / file.size) : 1,
			loaded,
			total: file.size,
			...meter(loaded, file.size),
		});
	};

	try {
		if (intent.single) {
			await putWithProgress(intent.single.url, file, report, signal);
			return await postJson<UploadResult>(
				`${basePath}/upload-complete`,
				{ fileId: intent.fileId },
				signal,
			);
		}

		const partSize = intent.partSize as number;
		const presigned = new Map(intent.parts?.map((p) => [p.partNumber, p.url]));
		// Per-part byte counts, summed for overall progress. Parts finish out of order, so a
		// running total would jump backwards.
		const loadedByPart = new Map<number, number>();
		const etags: { partNumber: number; etag: string }[] = [];

		const reportTotal = () => {
			let total = 0;
			for (const bytes of loadedByPart.values()) total += bytes;
			report(total);
		};

		const partNumbers = [...presigned.keys()].sort((a, b) => a - b);

		await runWithConcurrency(partNumbers, CONCURRENCY, async (partNumber) => {
			const start = (partNumber - 1) * partSize;
			const chunk = file.slice(start, Math.min(start + partSize, file.size));

			const send = async (url: string) =>
				putWithProgress(
					url,
					chunk,
					(loaded) => {
						loadedByPart.set(partNumber, loaded);
						reportTotal();
					},
					signal,
				);

			let etag: string;
			try {
				etag = await send(presigned.get(partNumber) as string);
			} catch (error) {
				if (!(error instanceof PresignExpired)) throw error;
				// An hour elapsed mid-upload. Get a fresh URL for just this part.
				const refreshed = await postJson<{
					parts: { partNumber: number; url: string }[];
				}>(
					`${basePath}/upload-parts`,
					{ fileId: intent.fileId, partNumbers: [partNumber] },
					signal,
				);
				etag = await send(refreshed.parts[0].url);
			}

			etags.push({ partNumber, etag });
		});

		return await postJson<UploadResult>(
			`${basePath}/upload-complete`,
			{ fileId: intent.fileId, parts: etags },
			signal,
		);
	} catch (error) {
		// Never leave a multipart upload dangling — R2 charges for orphaned parts.
		await fetch(`${basePath}/upload-abort`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ fileId: intent.fileId }),
			keepalive: true,
		}).catch(() => {});

		if (signal.aborted) throw new UploadCancelled();
		throw error;
	}
}
