import { useCallback, useEffect, useRef, useState } from "react";
import {
	UploadCancelled,
	type UploadProgress,
	type UploadResult,
	uploadFile,
} from "~/lib/uploader";

export interface UploadItem {
	/** Client-side id; the server fileId only exists after intent succeeds. */
	key: string;
	file: File;
	status: "uploading" | "done" | "error" | "cancelled";
	progress: UploadProgress | null;
	result: UploadResult | null;
	error: string | null;
}

let counter = 0;

/**
 * Runs the upload queue for a page. Uploads run concurrently at the file level; each file
 * internally runs its own parts in parallel.
 */
export function useUploads({
	basePath = "/app",
	onComplete,
}: {
	basePath?: string;
	onComplete?: (result: UploadResult) => void;
} = {}) {
	const [items, setItems] = useState<UploadItem[]>([]);
	const controllers = useRef(new Map<string, AbortController>());

	const patch = useCallback((key: string, changes: Partial<UploadItem>) => {
		setItems((current) =>
			current.map((item) => (item.key === key ? { ...item, ...changes } : item)),
		);
	}, []);

	const add = useCallback(
		(files: File[]) => {
			for (const file of files) {
				const key = `u${++counter}`;
				const controller = new AbortController();
				controllers.current.set(key, controller);

				setItems((current) => [
					...current,
					{ key, file, status: "uploading", progress: null, result: null, error: null },
				]);

				uploadFile(file, {
					basePath,
					signal: controller.signal,
					onProgress: (progress) => patch(key, { progress }),
				})
					.then((result) => {
						patch(key, { status: "done", result });
						onComplete?.(result);
					})
					.catch((error: Error) => {
						if (error instanceof UploadCancelled) {
							patch(key, { status: "cancelled" });
						} else {
							patch(key, { status: "error", error: error.message });
						}
					})
					.finally(() => controllers.current.delete(key));
			}
		},
		[basePath, onComplete, patch],
	);

	const cancel = useCallback((key: string) => {
		controllers.current.get(key)?.abort();
	}, []);

	const dismiss = useCallback((key: string) => {
		setItems((current) => current.filter((item) => item.key !== key));
	}, []);

	const active = items.some((item) => item.status === "uploading");

	// Don't let a tab close silently orphan an in-flight multipart upload.
	useEffect(() => {
		if (!active) return;
		const warn = (event: BeforeUnloadEvent) => event.preventDefault();
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [active]);

	return { items, add, cancel, dismiss, active };
}
