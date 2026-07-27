/**
 * Secrets, which `wrangler types` can't infer — they live in .dev.vars locally and in
 * `wrangler secret put` in production, not in wrangler.jsonc.
 *
 * Bindings (DB, BUCKET) and plain vars (APP_URL) come from worker-configuration.d.ts.
 * Keep in sync with .dev.vars.example and PLAN.md §9.
 */
interface Env {
	SESSION_SECRET: string;

	R2_ACCOUNT_ID: string;
	R2_ACCESS_KEY_ID: string;
	R2_SECRET_ACCESS_KEY: string;
	R2_BUCKET: string;
	R2_S3_ENDPOINT: string;

	RESEND_API_KEY: string;
	OTP_FROM_EMAIL: string;

	OWNER_EMAIL: string;
}
