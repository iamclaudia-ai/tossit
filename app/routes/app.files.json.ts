import { and, desc, eq, isNull } from "drizzle-orm";
import { cloudflareContext } from "~/context";
import { getDb } from "~/db";
import { files } from "~/db/schema";
import { requireUser } from "~/lib/auth";
import { getRequestOrigin } from "~/lib/origin";
import type { Route } from "./+types/app.files.json";

/** `tossit list`. Same ownership scope as the dashboard — admins see everything, members their own. */
export async function loader({ request, context }: Route.LoaderArgs) {
	const env = context.get(cloudflareContext).env;
	const { uploaderScope } = await requireUser(env, request);

	const rows = await getDb(env)
		.select()
		.from(files)
		.where(
			and(
				eq(files.status, "complete"),
				isNull(files.deletedAt),
				...(uploaderScope ? [eq(files.uploadedBy, uploaderScope)] : []),
			),
		)
		.orderBy(desc(files.completedAt))
		.limit(50);

	const origin = getRequestOrigin(request);
	return Response.json({
		files: rows.map((row) => ({
			id: row.id,
			filename: row.filename,
			size: row.size,
			url: `${origin}/d/${row.slug}`,
			completedAt: row.completedAt,
			expiresAt: row.expiresAt,
			downloadCount: row.downloadCount,
		})),
	});
}
