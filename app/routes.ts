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
] satisfies RouteConfig;
