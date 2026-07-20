PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cms_content` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`slug` text NOT NULL,
	`stable_key` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`published_at` integer,
	`review_status` text DEFAULT 'draft' NOT NULL,
	`reviewed_by_email` text,
	`reviewed_at` integer,
	`approved_revision` integer,
	`created_by_email` text NOT NULL,
	`updated_by_email` text NOT NULL,
	CONSTRAINT "cms_content_kind_check" CHECK(`kind` in ('vocabulary', 'lesson')),
	CONSTRAINT "cms_content_status_check" CHECK(`status` in ('draft', 'published')),
	CONSTRAINT "cms_content_review_status_check" CHECK(`review_status` in ('draft', 'pending', 'approved', 'changes_requested'))
);--> statement-breakpoint
INSERT INTO `__new_cms_content` (
	`id`, `kind`, `slug`, `stable_key`, `title`, `content`, `status`, `revision`,
	`created_at`, `updated_at`, `published_at`, `review_status`,
	`reviewed_by_email`, `reviewed_at`, `approved_revision`,
	`created_by_email`, `updated_by_email`
)
SELECT
	content.`id`, content.`kind`, content.`slug`,
	COALESCE(
		(
			SELECT first_revision.`slug`
			FROM `cms_content_revisions` AS first_revision
			WHERE first_revision.`content_id` = content.`id`
			ORDER BY first_revision.`revision` ASC
			LIMIT 1
		),
		content.`slug`
	),
	content.`title`, content.`content`, content.`status`, content.`revision`,
	content.`created_at`, content.`updated_at`, content.`published_at`, 'draft',
	NULL, NULL, NULL, content.`created_by_email`, content.`updated_by_email`
FROM `cms_content` AS content;--> statement-breakpoint
DROP TABLE `cms_content`;--> statement-breakpoint
ALTER TABLE `__new_cms_content` RENAME TO `cms_content`;--> statement-breakpoint
CREATE UNIQUE INDEX `cms_content_kind_slug_unique` ON `cms_content` (`kind`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `cms_content_kind_stable_key_unique` ON `cms_content` (`kind`,`stable_key`);--> statement-breakpoint
CREATE INDEX `cms_content_status_updated_idx` ON `cms_content` (`status`,`updated_at`);--> statement-breakpoint

CREATE TABLE `__new_cms_content_revisions` (
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
	PRIMARY KEY(`content_id`, `revision`),
	CONSTRAINT "cms_content_revisions_kind_check" CHECK(`kind` in ('vocabulary', 'lesson')),
	CONSTRAINT "cms_content_revisions_status_check" CHECK(`status` in ('draft', 'published')),
	CONSTRAINT "cms_content_revisions_action_check" CHECK(`action` in ('CREATE', 'UPDATE', 'PUBLISH', 'UNPUBLISH', 'RESTORE', 'MIGRATION'))
);--> statement-breakpoint
INSERT INTO `__new_cms_content_revisions` (
	`content_id`, `revision`, `kind`, `slug`, `stable_key`, `title`, `content`,
	`status`, `published_at`, `actor_email`, `action`, `created_at`
)
SELECT
	revision.`content_id`, revision.`revision`, revision.`kind`, revision.`slug`,
	COALESCE(
		(SELECT content.`stable_key` FROM `cms_content` AS content WHERE content.`id` = revision.`content_id`),
		(
			SELECT first_revision.`slug`
			FROM `cms_content_revisions` AS first_revision
			WHERE first_revision.`content_id` = revision.`content_id`
			ORDER BY first_revision.`revision` ASC
			LIMIT 1
		),
		revision.`slug`
	),
	revision.`title`, revision.`content`, revision.`status`, revision.`published_at`,
	revision.`actor_email`, revision.`action`, revision.`created_at`
FROM `cms_content_revisions` AS revision;--> statement-breakpoint
DROP TABLE `cms_content_revisions`;--> statement-breakpoint
ALTER TABLE `__new_cms_content_revisions` RENAME TO `cms_content_revisions`;--> statement-breakpoint
CREATE INDEX `cms_content_revisions_created_idx` ON `cms_content_revisions` (`content_id`,`created_at`);--> statement-breakpoint

CREATE TABLE `__new_cms_slug_tombstones` (
	`kind` text NOT NULL,
	`slug` text NOT NULL,
	`stable_key` text NOT NULL,
	`content_id` text NOT NULL,
	`retired_at` integer NOT NULL,
	`retired_by_email` text NOT NULL,
	PRIMARY KEY(`kind`, `slug`),
	CONSTRAINT "cms_slug_tombstones_kind_check" CHECK(`kind` in ('vocabulary', 'lesson'))
);--> statement-breakpoint
INSERT INTO `__new_cms_slug_tombstones` (
	`kind`, `slug`, `stable_key`, `content_id`, `retired_at`, `retired_by_email`
)
SELECT
	tombstone.`kind`, tombstone.`slug`,
	COALESCE(
		(SELECT content.`stable_key` FROM `cms_content` AS content WHERE content.`id` = tombstone.`content_id`),
		(
			SELECT first_revision.`stable_key`
			FROM `cms_content_revisions` AS first_revision
			WHERE first_revision.`content_id` = tombstone.`content_id`
			ORDER BY first_revision.`revision` ASC
			LIMIT 1
		),
		tombstone.`slug`
	),
	tombstone.`content_id`, tombstone.`retired_at`, tombstone.`retired_by_email`
FROM `cms_slug_tombstones` AS tombstone;--> statement-breakpoint
DROP TABLE `cms_slug_tombstones`;--> statement-breakpoint
ALTER TABLE `__new_cms_slug_tombstones` RENAME TO `cms_slug_tombstones`;--> statement-breakpoint
CREATE INDEX `cms_slug_tombstones_content_idx` ON `cms_slug_tombstones` (`content_id`);--> statement-breakpoint

CREATE TABLE `cms_vocabulary_aliases` (
	`alias` text PRIMARY KEY NOT NULL,
	`content_id` text NOT NULL,
	`stable_key` text NOT NULL,
	`created_at` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `cms_vocabulary_aliases_content_idx` ON `cms_vocabulary_aliases` (`content_id`);--> statement-breakpoint
CREATE INDEX `cms_vocabulary_aliases_stable_idx` ON `cms_vocabulary_aliases` (`stable_key`);--> statement-breakpoint
INSERT OR IGNORE INTO `cms_vocabulary_aliases` (`alias`, `content_id`, `stable_key`, `created_at`)
SELECT `slug`, `content_id`, `stable_key`, `created_at`
FROM `cms_content_revisions`
WHERE `kind` = 'vocabulary';--> statement-breakpoint
INSERT OR IGNORE INTO `cms_vocabulary_aliases` (`alias`, `content_id`, `stable_key`, `created_at`)
SELECT `slug`, `id`, `stable_key`, `created_at`
FROM `cms_content`
WHERE `kind` = 'vocabulary';--> statement-breakpoint
INSERT OR IGNORE INTO `cms_vocabulary_aliases` (`alias`, `content_id`, `stable_key`, `created_at`)
SELECT `slug`, `content_id`, `stable_key`, `retired_at`
FROM `cms_slug_tombstones`
WHERE `kind` = 'vocabulary';--> statement-breakpoint
CREATE INDEX `admin_audit_created_idx` ON `admin_audit_log` (`created_at`,`id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
