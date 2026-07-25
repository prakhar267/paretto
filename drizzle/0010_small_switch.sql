CREATE TABLE `native_learner_links` (
	`native_account_id` text PRIMARY KEY NOT NULL,
	`learner_user_id` text NOT NULL,
	`linked_at` integer NOT NULL,
	FOREIGN KEY (`native_account_id`) REFERENCES `native_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`learner_user_id`) REFERENCES `learner_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `native_learner_links_user_unique` ON `native_learner_links` (`learner_user_id`);