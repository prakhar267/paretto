CREATE TABLE `retention_schedule_state` (
	`job_name` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`monitoring_started_at` integer NOT NULL,
	`run_id` text,
	`scheduled_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`last_succeeded_at` integer,
	`last_failed_at` integer,
	`last_error` text,
	`last_result` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT "retention_schedule_state_status_check" CHECK("retention_schedule_state"."status" in ('pending', 'running', 'succeeded', 'failed'))
);
--> statement-breakpoint
INSERT INTO `retention_schedule_state` (
	`job_name`,
	`status`,
	`monitoring_started_at`,
	`updated_at`
) VALUES (
	'scheduled_retention',
	'pending',
	CAST(unixepoch('now') AS INTEGER) * 1000,
	CAST(unixepoch('now') AS INTEGER) * 1000
);
