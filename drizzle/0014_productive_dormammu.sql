CREATE TABLE `apple_account_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`apple_subject_hash` text NOT NULL,
	`event_time` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`received_at` integer NOT NULL,
	`processed_at` integer,
	CONSTRAINT "apple_account_notifications_event_type_check" CHECK("apple_account_notifications"."event_type" in ('email-enabled', 'email-disabled', 'consent-revoked', 'account-deleted')),
	CONSTRAINT "apple_account_notifications_status_check" CHECK("apple_account_notifications"."status" in ('pending', 'processed', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `apple_account_notifications_status_idx` ON `apple_account_notifications` (`status`,`received_at`);--> statement-breakpoint
CREATE INDEX `apple_account_notifications_subject_idx` ON `apple_account_notifications` (`apple_subject_hash`,`event_time`);--> statement-breakpoint
ALTER TABLE `native_accounts` ADD `email_forwarding_enabled` integer;