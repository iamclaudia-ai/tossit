import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
	index("routes/home.tsx"),
	route("health", "routes/health.tsx"),

	// Public download
	route("d/:slug", "routes/download.tsx"),
	route("d/:slug/raw", "routes/download.raw.ts"),

	// Auth
	route("auth/passkey/options", "routes/auth.passkey.options.ts"),
	route("auth/passkey/verify", "routes/auth.passkey.verify.ts"),
	route("auth/passkey/register", "routes/auth.passkey.register.ts"),
	route("auth/signout", "routes/auth.signout.ts"),

	// App (session required)
	route("app", "routes/app.tsx"),
	route("app/upload-intent", "routes/app.upload-intent.ts"),
	route("app/upload-parts", "routes/app.upload-parts.ts"),
	route("app/upload-complete", "routes/app.upload-complete.ts"),
	route("app/upload-abort", "routes/app.upload-abort.ts"),
	route("app/files/:id/delete", "routes/app.files.$id.delete.ts"),
	route("app/files/:id/settings", "routes/app.files.$id.settings.ts"),
] satisfies RouteConfig;
