import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "~/db";
import { files } from "~/db/schema";

/**
 * Shared guards for the upload endpoints. Both the signed-in (/app/*) and anonymous invite
 * (/i/:code/*) flows funnel through these, so the rules can't drift apart.
 */

/** PLAN.md §7. Client-claimed size is checked here and the real size is verified on complete. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024 * 1024;

/** Default link lifetime. Overridable per file in Phase 5, including "never". */
export const DEFAULT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

export interface IntentInput {
	filename: string;
	size: number;
	contentType?: string;
}

export function validateIntent(input: Partial<IntentInput>): string | null {
	if (!input.filename || typeof input.filename !== "string") {
		return "A filename is required.";
	}
	if (input.filename.length > 255) return "That filename is too long.";
	if (typeof input.size !== "number" || !Number.isFinite(input.size) || input.size < 0) {
		return "A valid file size is required.";
	}
	if (input.size > MAX_FILE_BYTES) return "That file is larger than 5 GB.";
	return null;
}

/**
 * Loads a pending upload the caller is actually allowed to touch. Every follow-up call in the
 * upload lifecycle (parts, complete, abort) re-checks ownership — a fileId is not a capability.
 */
export async function loadPendingUpload(
	env: Env,
	fileId: string,
	owner: { userId?: string; inviteId?: string },
) {
	const db = getDb(env);
	const row = await db
		.select()
		.from(files)
		.where(
			and(eq(files.id, fileId), eq(files.status, "pending"), isNull(files.deletedAt)),
		)
		.get();

	if (!row) return null;
	if (owner.userId && row.uploadedBy !== owner.userId) return null;
	if (owner.inviteId && row.inviteId !== owner.inviteId) return null;
	return row;
}
