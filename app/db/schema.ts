import { relations } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Data model for tossit.sh — see PLAN.md §3.
 *
 * Conventions:
 * - ids are nanoids (text pk)
 * - all timestamps are unix epoch **milliseconds**, stored as integers
 * - anything reachable from a public URL (slug, invite code) is 128 bits of entropy
 */

const now = () => Date.now();

export const users = sqliteTable("users", {
	id: text("id").primaryKey(),
	email: text("email").notNull().unique(),
	name: text("name"),
	/**
	 * owner  — exactly one, created by bootstrap. Its role can never be changed through the
	 *          app, so the account can't be locked out or demoted by anyone.
	 * admin  — everything an owner can do except touch the owner's role.
	 * member — uploads and manages only their own files.
	 */
	role: text("role", { enum: ["owner", "admin", "member"] })
		.notNull()
		.default("member"),
	createdAt: integer("created_at").notNull().$defaultFn(now),
});

/** WebAuthn passkeys. */
export const credentials = sqliteTable(
	"credentials",
	{
		/** Credential ID, base64url. */
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		/** COSE public key, base64url. Text rather than a blob so nothing needs node Buffer. */
		publicKey: text("public_key").notNull(),
		counter: integer("counter").notNull().default(0),
		/** JSON array of AuthenticatorTransport. */
		transports: text("transports"),
		deviceType: text("device_type", { enum: ["singleDevice", "multiDevice"] }),
		backedUp: integer("backed_up", { mode: "boolean" }).notNull().default(false),
		nickname: text("nickname"),
		createdAt: integer("created_at").notNull().$defaultFn(now),
		lastUsedAt: integer("last_used_at"),
	},
	(t) => [index("credentials_user_id_idx").on(t.userId)],
);

export const sessions = sqliteTable(
	"sessions",
	{
		/** Opaque, 32 random bytes, base64url. */
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		userAgent: text("user_agent"),
		createdAt: integer("created_at").notNull().$defaultFn(now),
		expiresAt: integer("expires_at").notNull(),
		revokedAt: integer("revoked_at"),
	},
	(t) => [index("sessions_user_id_idx").on(t.userId)],
);

/** Short-lived WebAuthn challenges, cleaned up by the daily cron. */
export const webauthnChallenges = sqliteTable("webauthn_challenges", {
	id: text("id").primaryKey(),
	challenge: text("challenge").notNull(),
	kind: text("kind", { enum: ["registration", "authentication"] }).notNull(),
	email: text("email"),
	expiresAt: integer("expires_at").notNull(),
});

/** Headless auth for the `toss` CLI — see PLAN.md §10 Phase 3.5. */
export const deviceTokens = sqliteTable(
	"device_tokens",
	{
		id: text("id").primaryKey(),
		/** SHA-256 of the token. The plaintext is shown exactly once, at mint time. */
		tokenHash: text("token_hash").notNull().unique(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		label: text("label"),
		createdAt: integer("created_at").notNull().$defaultFn(now),
		lastUsedAt: integer("last_used_at"),
		/** null = never expires */
		expiresAt: integer("expires_at"),
		revokedAt: integer("revoked_at"),
	},
	(t) => [index("device_tokens_user_id_idx").on(t.userId)],
);

export const invites = sqliteTable("invites", {
	id: text("id").primaryKey(),
	/** 128-bit random, base64url, 22 chars. */
	code: text("code").notNull().unique(),
	kind: text("kind", { enum: ["upload", "account"] }).notNull(),
	/** For my own memory: "Dave from the podcast". */
	label: text("label"),
	/** Optional pre-fill / restriction for 'account' invites. */
	email: text("email"),
	maxUploads: integer("max_uploads").default(1),
	uses: integer("uses").notNull().default(0),
	createdBy: text("created_by")
		.notNull()
		.references(() => users.id),
	createdAt: integer("created_at").notNull().$defaultFn(now),
	expiresAt: integer("expires_at"),
	claimedAt: integer("claimed_at"),
	claimedBy: text("claimed_by").references(() => users.id),
	revokedAt: integer("revoked_at"),
});

export const otpCodes = sqliteTable(
	"otp_codes",
	{
		id: text("id").primaryKey(),
		email: text("email").notNull(),
		/** SHA-256. Never store the plaintext code. */
		codeHash: text("code_hash").notNull(),
		inviteId: text("invite_id").references(() => invites.id, {
			onDelete: "cascade",
		}),
		attempts: integer("attempts").notNull().default(0),
		expiresAt: integer("expires_at").notNull(),
		consumedAt: integer("consumed_at"),
	},
	(t) => [index("otp_codes_email_idx").on(t.email)],
);

export const files = sqliteTable(
	"files",
	{
		id: text("id").primaryKey(),
		/** The public link token. 128-bit random, base64url, 22 chars. */
		slug: text("slug").notNull().unique(),
		/** `${id}/${sanitizedFilename}` */
		r2Key: text("r2_key").notNull(),
		filename: text("filename").notNull(),
		contentType: text("content_type"),
		/** Bytes. Null until the upload completes. */
		size: integer("size"),
		status: text("status", { enum: ["pending", "complete", "aborted"] })
			.notNull()
			.default("pending"),
		/** R2 multipart uploadId while in flight. */
		multipartId: text("multipart_id"),
		/** Null for anonymous invite uploads. */
		uploadedBy: text("uploaded_by").references(() => users.id, {
			onDelete: "set null",
		}),
		inviteId: text("invite_id").references(() => invites.id, {
			onDelete: "set null",
		}),
		createdAt: integer("created_at").notNull().$defaultFn(now),
		completedAt: integer("completed_at"),
		/** null = never expires */
		expiresAt: integer("expires_at"),
		/** null = unlimited */
		maxDownloads: integer("max_downloads"),
		downloadCount: integer("download_count").notNull().default(0),
		deletedAt: integer("deleted_at"),
	},
	(t) => [
		index("files_uploaded_by_idx").on(t.uploadedBy),
		index("files_status_idx").on(t.status),
		index("files_expires_at_idx").on(t.expiresAt),
	],
);

export const downloadEvents = sqliteTable(
	"download_events",
	{
		id: text("id").primaryKey(),
		fileId: text("file_id")
			.notNull()
			.references(() => files.id, { onDelete: "cascade" }),
		/** Hashed — never keep raw IPs. */
		ipHash: text("ip_hash"),
		userAgent: text("user_agent"),
		createdAt: integer("created_at").notNull().$defaultFn(now),
	},
	(t) => [index("download_events_file_id_idx").on(t.fileId)],
);

export const usersRelations = relations(users, ({ many }) => ({
	credentials: many(credentials),
	sessions: many(sessions),
	deviceTokens: many(deviceTokens),
	files: many(files),
}));

export const credentialsRelations = relations(credentials, ({ one }) => ({
	user: one(users, { fields: [credentials.userId], references: [users.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
	user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const deviceTokensRelations = relations(deviceTokens, ({ one }) => ({
	user: one(users, { fields: [deviceTokens.userId], references: [users.id] }),
}));

export const invitesRelations = relations(invites, ({ one, many }) => ({
	creator: one(users, { fields: [invites.createdBy], references: [users.id] }),
	files: many(files),
}));

export const filesRelations = relations(files, ({ one, many }) => ({
	uploader: one(users, { fields: [files.uploadedBy], references: [users.id] }),
	invite: one(invites, { fields: [files.inviteId], references: [invites.id] }),
	downloadEvents: many(downloadEvents),
}));

export const downloadEventsRelations = relations(downloadEvents, ({ one }) => ({
	file: one(files, { fields: [downloadEvents.fileId], references: [files.id] }),
}));

export type User = typeof users.$inferSelect;
export type Credential = typeof credentials.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type DeviceToken = typeof deviceTokens.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type FileRow = typeof files.$inferSelect;
