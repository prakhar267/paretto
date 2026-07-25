CREATE TABLE `learner_deletion_jobs` (
	`user_id` text PRIMARY KEY NOT NULL,
	`user_key` text NOT NULL,
	`native_account_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_at` integer NOT NULL,
	`completed_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT "learner_deletion_jobs_status_check" CHECK("learner_deletion_jobs"."status" in ('pending', 'held', 'completed'))
);
--> statement-breakpoint
CREATE INDEX `learner_deletion_jobs_status_updated_idx` ON `learner_deletion_jobs` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `support_notification_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`support_request_id` text NOT NULL,
	`event_type` text NOT NULL,
	`support_revision` integer NOT NULL,
	`support_status` text NOT NULL,
	`recipient_email` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`available_at` integer NOT NULL,
	`lease_expires_at` integer,
	`last_error` text,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`support_request_id`) REFERENCES `support_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "support_notification_jobs_event_type_check" CHECK("support_notification_jobs"."event_type" in ('operator_created', 'requester_created', 'requester_status')),
	CONSTRAINT "support_notification_jobs_support_status_check" CHECK("support_notification_jobs"."support_status" in ('open', 'in_progress', 'resolved', 'closed')),
	CONSTRAINT "support_notification_jobs_status_check" CHECK("support_notification_jobs"."status" in ('pending', 'processing', 'failed', 'completed')),
	CONSTRAINT "support_notification_jobs_attempts_check" CHECK("support_notification_jobs"."attempts" >= 0),
	CONSTRAINT "support_notification_jobs_recipient_check" CHECK(("support_notification_jobs"."event_type" = 'operator_created' AND "support_notification_jobs"."recipient_email" IS NULL) OR ("support_notification_jobs"."event_type" IN ('requester_created', 'requester_status') AND "support_notification_jobs"."recipient_email" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `support_notification_jobs_event_unique` ON `support_notification_jobs` (`support_request_id`,`event_type`,`support_revision`);--> statement-breakpoint
CREATE INDEX `support_notification_jobs_delivery_idx` ON `support_notification_jobs` (`status`,`available_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `support_rate_limits` (
	`bucket_hash` text PRIMARY KEY NOT NULL,
	`window_started_at` integer NOT NULL,
	`request_count` integer NOT NULL,
	`last_reservation_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "support_rate_limits_request_count_check" CHECK("support_rate_limits"."request_count" >= 1 AND "support_rate_limits"."request_count" <= 20)
);
--> statement-breakpoint
CREATE INDEX `support_rate_limits_updated_idx` ON `support_rate_limits` (`updated_at`);--> statement-breakpoint
DROP INDEX `cms_content_kind_slug_unique`;--> statement-breakpoint
DROP INDEX `cms_content_kind_stable_key_unique`;--> statement-breakpoint
DROP INDEX `cms_content_status_updated_idx`;--> statement-breakpoint
ALTER TABLE `cms_content` ADD `course_id` text DEFAULT 'french-from-english' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `cms_content_kind_slug_unique` ON `cms_content` (`course_id`,`kind`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `cms_content_kind_stable_key_unique` ON `cms_content` (`course_id`,`kind`,`stable_key`);--> statement-breakpoint
CREATE INDEX `cms_content_status_updated_idx` ON `cms_content` (`course_id`,`status`,`updated_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cms_content_revisions` (
	`course_id` text DEFAULT 'french-from-english' NOT NULL,
	`content_id` text NOT NULL,
	`revision` integer NOT NULL,
	`kind` text NOT NULL,
	`slug` text NOT NULL,
	`stable_key` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`status` text NOT NULL,
	`published_at` integer,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`course_id`, `content_id`, `revision`),
	CONSTRAINT "cms_content_revisions_kind_check" CHECK("__new_cms_content_revisions"."kind" in ('vocabulary', 'lesson')),
	CONSTRAINT "cms_content_revisions_status_check" CHECK("__new_cms_content_revisions"."status" in ('draft', 'published')),
	CONSTRAINT "cms_content_revisions_action_check" CHECK("__new_cms_content_revisions"."action" in ('CREATE', 'UPDATE', 'PUBLISH', 'UNPUBLISH', 'RESTORE', 'MIGRATION'))
);
--> statement-breakpoint
INSERT INTO `__new_cms_content_revisions`("course_id", "content_id", "revision", "kind", "slug", "stable_key", "title", "content", "status", "published_at", "actor_email", "action", "created_at") SELECT 'french-from-english', "content_id", "revision", "kind", "slug", "stable_key", "title", "content", "status", "published_at", "actor_email", "action", "created_at" FROM `cms_content_revisions`;--> statement-breakpoint
DROP TABLE `cms_content_revisions`;--> statement-breakpoint
ALTER TABLE `__new_cms_content_revisions` RENAME TO `cms_content_revisions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `cms_content_revisions_created_idx` ON `cms_content_revisions` (`course_id`,`content_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_cms_slug_tombstones` (
	`course_id` text DEFAULT 'french-from-english' NOT NULL,
	`kind` text NOT NULL,
	`slug` text NOT NULL,
	`stable_key` text NOT NULL,
	`content_id` text NOT NULL,
	`retired_at` integer NOT NULL,
	`retired_by_email` text NOT NULL,
	PRIMARY KEY(`course_id`, `kind`, `slug`),
	CONSTRAINT "cms_slug_tombstones_kind_check" CHECK("__new_cms_slug_tombstones"."kind" in ('vocabulary', 'lesson'))
);
--> statement-breakpoint
INSERT INTO `__new_cms_slug_tombstones`("course_id", "kind", "slug", "stable_key", "content_id", "retired_at", "retired_by_email") SELECT 'french-from-english', "kind", "slug", "stable_key", "content_id", "retired_at", "retired_by_email" FROM `cms_slug_tombstones`;--> statement-breakpoint
DROP TABLE `cms_slug_tombstones`;--> statement-breakpoint
ALTER TABLE `__new_cms_slug_tombstones` RENAME TO `cms_slug_tombstones`;--> statement-breakpoint
CREATE INDEX `cms_slug_tombstones_content_idx` ON `cms_slug_tombstones` (`course_id`,`content_id`);--> statement-breakpoint
CREATE TABLE `__new_cms_vocabulary_aliases` (
	`course_id` text DEFAULT 'french-from-english' NOT NULL,
	`alias` text NOT NULL,
	`content_id` text NOT NULL,
	`stable_key` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`course_id`, `alias`)
);
--> statement-breakpoint
INSERT INTO `__new_cms_vocabulary_aliases`("course_id", "alias", "content_id", "stable_key", "created_at") SELECT 'french-from-english', "alias", "content_id", "stable_key", "created_at" FROM `cms_vocabulary_aliases`;--> statement-breakpoint
DROP TABLE `cms_vocabulary_aliases`;--> statement-breakpoint
ALTER TABLE `__new_cms_vocabulary_aliases` RENAME TO `cms_vocabulary_aliases`;--> statement-breakpoint
CREATE INDEX `cms_vocabulary_aliases_content_idx` ON `cms_vocabulary_aliases` (`course_id`,`content_id`);--> statement-breakpoint
CREATE INDEX `cms_vocabulary_aliases_stable_idx` ON `cms_vocabulary_aliases` (`course_id`,`stable_key`);
