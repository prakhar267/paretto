CREATE TABLE `learner_account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `learner_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `learner_account_user_idx` ON `learner_account` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `learner_account_provider_unique` ON `learner_account` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `learner_identity_links` (
	`anonymous_user_key` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`linked_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `learner_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `learner_identity_links_account_idx` ON `learner_identity_links` (`account_id`);--> statement-breakpoint
CREATE TABLE `learner_rate_limit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learner_rate_limit_key_unique` ON `learner_rate_limit` (`key`);--> statement-breakpoint
CREATE INDEX `learner_rate_limit_last_request_idx` ON `learner_rate_limit` (`last_request`);--> statement-breakpoint
CREATE TABLE `learner_session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `learner_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learner_session_token_unique` ON `learner_session` (`token`);--> statement-breakpoint
CREATE INDEX `learner_session_user_idx` ON `learner_session` (`user_id`);--> statement-breakpoint
CREATE INDEX `learner_session_expiry_idx` ON `learner_session` (`expires_at`);--> statement-breakpoint
CREATE TABLE `learner_user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learner_user_email_unique` ON `learner_user` (`email`);--> statement-breakpoint
CREATE TABLE `learner_verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `learner_verification_identifier_idx` ON `learner_verification` (`identifier`);--> statement-breakpoint
CREATE INDEX `learner_verification_expiry_idx` ON `learner_verification` (`expires_at`);