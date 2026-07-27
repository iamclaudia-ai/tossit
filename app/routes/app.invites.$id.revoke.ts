import { eq } from "drizzle-orm";
import { getDb } from "~/db";
import { invites } from "~/db/schema";
import { requireOwner } from "~/lib/auth";
import type { Route } from "./+types/app.invites.$id.revoke";

/** Kills an invite immediately. Already-claimed accounts are unaffected — revoke the user. */
export async function action({ params, request, context }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	await requireOwner(env, request);

	const db = getDb(env);
	const invite = await db.select().from(invites).where(eq(invites.id, params.id)).get();
	if (!invite) return Response.json({ error: "Not found." }, { status: 404 });

	await db
		.update(invites)
		.set({ revokedAt: Date.now() })
		.where(eq(invites.id, invite.id));

	return Response.json({ ok: true });
}
