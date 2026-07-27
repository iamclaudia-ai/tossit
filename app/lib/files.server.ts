import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "~/db";
import { files } from "~/db/schema";
import type { AuthedUser } from "./auth";

/**
 * Loads a file the caller is allowed to manage, honoring the ownership scope: owners reach
 * every file, members only their own. Every mutation goes through here — never trust an id
 * from the client to imply permission.
 */
export async function loadManageableFile(env: Env, fileId: string, authed: AuthedUser) {
	return await getDb(env)
		.select()
		.from(files)
		.where(
			and(
				eq(files.id, fileId),
				isNull(files.deletedAt),
				...(authed.uploaderScope ? [eq(files.uploadedBy, authed.uploaderScope)] : []),
			),
		)
		.get();
}

/** Expiry choices offered in the UI, in milliseconds from now. null = never. */
export const EXPIRY_OPTIONS = {
	"1h": 60 * 60 * 1000,
	"24h": 24 * 60 * 60 * 1000,
	"7d": 7 * 24 * 60 * 60 * 1000,
	"30d": 30 * 24 * 60 * 60 * 1000,
	never: null,
} as const;

export type ExpiryChoice = keyof typeof EXPIRY_OPTIONS;

export const isExpiryChoice = (value: string): value is ExpiryChoice =>
	value in EXPIRY_OPTIONS;

/**
 * Download caps are counted from *now*, not from zero: setting "1 more download" on a link
 * that's already been fetched three times should allow one more, not lock it immediately.
 */
export function resolveMaxDownloads(
	choice: string,
	currentCount: number,
): number | null | "invalid" {
	if (choice === "unlimited") return null;
	const extra = Number(choice);
	if (!Number.isInteger(extra) || extra < 1 || extra > 1000) return "invalid";
	return currentCount + extra;
}
