import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
	index("routes/home.tsx"),
	route("health", "routes/health.tsx"),

	// Public download
	route("d/:slug", "routes/download.tsx"),
	route("d/:slug/raw", "routes/download.raw.ts"),

	// Invites (public)
	route("i/:code", "routes/invite.tsx"),
	route("i/:code/upload-intent", "routes/invite.upload-intent.ts"),
	route("i/:code/upload-parts", "routes/invite.upload-parts.ts"),
	route("i/:code/upload-complete", "routes/invite.upload-complete.ts"),
	route("i/:code/upload-abort", "routes/invite.upload-abort.ts"),

	// Auth
	route("auth/passkey/options", "routes/auth.passkey.options.ts"),
	route("auth/otp/request", "routes/auth.otp.request.ts"),
	route("auth/otp/verify", "routes/auth.otp.verify.ts"),
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
	route("app/settings", "routes/app.settings.tsx"),
	route("app/invites", "routes/app.invites.tsx"),
	route("app/invites/:id/revoke", "routes/app.invites.$id.revoke.ts"),
] satisfies RouteConfig;
