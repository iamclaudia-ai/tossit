CREATE TABLE `device_authorizations` (
	`id` text PRIMARY KEY NOT NULL,
	`device_code_hash` text NOT NULL,
	`user_code` text NOT NULL,
	`label` text,
	`approved_at` integer,
	`approved_by` text,
	`token_plain` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_authorizations_device_code_hash_unique` ON `device_authorizations` (`device_code_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `device_authorizations_user_code_unique` ON `device_authorizations` (`user_code`);