import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
	index("routes/home.tsx"),
	route("health", "routes/health.tsx"),

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
] satisfies RouteConfig;
