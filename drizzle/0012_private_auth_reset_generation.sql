CREATE TABLE `learner_auth_rate_limits` (
	`bucket_hash` text PRIMARY KEY NOT NULL,
	`request_count` integer NOT NULL,
	`last_request_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "learner_auth_rate_limits_request_count_check" CHECK("learner_auth_rate_limits"."request_count" >= 1)
);
--> statement-breakpoint
CREATE INDEX `learner_auth_rate_limits_updated_idx` ON `learner_auth_rate_limits` (`updated_at`);--> statement-breakpoint
CREATE TABLE `learner_progress_generations` (
	`user_key` text PRIMARY KEY NOT NULL,
	`generation` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "learner_progress_generations_generation_check" CHECK("learner_progress_generations"."generation" >= 1)
);
--> statement-breakpoint
DROP TABLE `learner_rate_limit`;--> statement-breakpoint
ALTER TABLE `native_learning_state` ADD `reset_generation` integer DEFAULT 0 NOT NULL;
