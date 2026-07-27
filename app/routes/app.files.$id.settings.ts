import { eq } from "drizzle-orm";
import { getDb } from "~/db";
import { files } from "~/db/schema";
import { requireUser } from "~/lib/auth";
import {
	EXPIRY_OPTIONS,
	isExpiryChoice,
	loadManageableFile,
	resolveMaxDownloads,
} from "~/lib/files.server";
import type { Route } from "./+types/app.files.$id.settings";

/** Change a link's expiry and download cap after the fact. */
export async function action({ params, request, context }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const authed = await requireUser(env, request);

	const file = await loadManageableFile(env, params.id, authed);
	if (!file) return Response.json({ error: "Not found." }, { status: 404 });

	const form = await request.formData();
	const changes: { expiresAt?: number | null; maxDownloads?: number | null } = {};

	const expiry = form.get("expiry");
	if (typeof expiry === "string" && expiry !== "") {
		if (!isExpiryChoice(expiry)) {
			return Response.json({ error: "Unknown expiry option." }, { status: 400 });
		}
		const offset = EXPIRY_OPTIONS[expiry];
		// Measured from now, so "24h" on a week-old link means another 24 hours.
		changes.expiresAt = offset === null ? null : Date.now() + offset;
	}

	const downloads = form.get("downloads");
	if (typeof downloads === "string" && downloads !== "") {
		const resolved = resolveMaxDownloads(downloads, file.downloadCount);
		if (resolved === "invalid") {
			return Response.json({ error: "Unknown download limit." }, { status: 400 });
		}
		changes.maxDownloads = resolved;
	}

	if (Object.keys(changes).length === 0) {
		return Response.json({ error: "Nothing to change." }, { status: 400 });
	}

	await getDb(env).update(files).set(changes).where(eq(files.id, file.id));
	return Response.json({ ok: true, ...changes });
}
