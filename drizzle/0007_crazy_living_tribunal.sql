CREATE TABLE `admin_login_attempts` (
	`ip_hash` text PRIMARY KEY NOT NULL,
	`window_started_at` integer NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`blocked_until` integer,
	`updated_at` integer NOT NULL,
	CONSTRAINT "admin_login_attempts_failed_check" CHECK("admin_login_attempts"."failed_attempts" >= 0)
);
--> statement-breakpoint
CREATE INDEX `admin_login_attempts_updated_idx` ON `admin_login_attempts` (`updated_at`);