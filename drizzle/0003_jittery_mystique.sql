CREATE TABLE `cms_content_revisions` (
	`content_id` text NOT NULL,
	`revision` integer NOT NULL,
	`kind` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`status` text NOT NULL,
	`published_at` integer,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`content_id`, `revision`),
	CONSTRAINT "cms_content_revisions_kind_check" CHECK("cms_content_revisions"."kind" in ('vocabulary', 'lesson')),
	CONSTRAINT "cms_content_revisions_status_check" CHECK("cms_content_revisions"."status" in ('draft', 'published')),
	CONSTRAINT "cms_content_revisions_action_check" CHECK("cms_content_revisions"."action" in ('CREATE', 'UPDATE', 'PUBLISH', 'UNPUBLISH', 'RESTORE', 'MIGRATION'))
);
--> statement-breakpoint
CREATE INDEX `cms_content_revisions_created_idx` ON `cms_content_revisions` (`content_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `cms_slug_tombstones` (
	`kind` text NOT NULL,
	`slug` text NOT NULL,
	`content_id` text NOT NULL,
	`retired_at` integer NOT NULL,
	`retired_by_email` text NOT NULL,
	PRIMARY KEY(`kind`, `slug`),
	CONSTRAINT "cms_slug_tombstones_kind_check" CHECK("cms_slug_tombstones"."kind" in ('vocabulary', 'lesson'))
);
--> statement-breakpoint
CREATE INDEX `cms_slug_tombstones_content_idx` ON `cms_slug_tombstones` (`content_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `cms_content_revisions` (
	`content_id`, `revision`, `kind`, `slug`, `title`, `content`, `status`,
	`published_at`, `actor_email`, `action`, `created_at`
)
SELECT
	`id`, `revision`, `kind`, `slug`, `title`, `content`, `status`,
	`published_at`, `updated_by_email`, 'MIGRATION', `updated_at`
FROM `cms_content`;
