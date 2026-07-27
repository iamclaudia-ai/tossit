import { sql } from "drizzle-orm";
import { getDb } from "~/db";
import type { Route } from "./+types/health";

/**
 * Phase 0 gate: proves the Worker can talk to D1 and read/write R2 through the binding.
 * Not linked from anywhere; hit it directly at /health.
 */
export async function loader({ context }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const checks: Record<string, string> = {};

	try {
		const db = getDb(env);
		const result = await db.get<{ ok: number }>(sql`select 1 as ok`);
		checks.d1 = result?.ok === 1 ? "ok" : "unexpected result";
	} catch (error) {
		checks.d1 = `error: ${(error as Error).message}`;
	}

	try {
		const key = `_health/${crypto.randomUUID()}`;
		const payload = `tossit health ${Date.now()}`;
		await env.BUCKET.put(key, payload);
		const readBack = await env.BUCKET.get(key);
		const text = await readBack?.text();
		await env.BUCKET.delete(key);
		checks.r2 = text === payload ? "ok" : "read-back mismatch";
	} catch (error) {
		checks.r2 = `error: ${(error as Error).message}`;
	}

	const healthy = Object.values(checks).every((value) => value === "ok");
	return Response.json(
		{ status: healthy ? "ok" : "degraded", checks },
		{ status: healthy ? 200 : 503 },
	);
}
