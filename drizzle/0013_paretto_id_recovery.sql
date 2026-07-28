CREATE TABLE `learner_recovery_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`generation_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `learner_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `learner_recovery_codes_user_generation_idx` ON `learner_recovery_codes` (`user_id`,`generation_id`);--> statement-breakpoint
CREATE TABLE `learner_recovery_state` (
	`user_id` text PRIMARY KEY NOT NULL,
	`generation_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `learner_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `learner_user` ADD `username` text;--> statement-breakpoint
ALTER TABLE `learner_user` ADD `display_username` text;--> statement-breakpoint
CREATE UNIQUE INDEX `learner_user_username_unique` ON `learner_user` (`username`);
