CREATE TABLE `admin_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`from_revision` integer,
	`to_revision` integer,
	`details` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "admin_audit_entity_type_check" CHECK("admin_audit_log"."entity_type" in ('content', 'support_request'))
);
--> statement-breakpoint
CREATE INDEX `admin_audit_entity_created_idx` ON `admin_audit_log` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `cms_content` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`published_at` integer,
	`created_by_email` text NOT NULL,
	`updated_by_email` text NOT NULL,
	CONSTRAINT "cms_content_kind_check" CHECK("cms_content"."kind" in ('vocabulary', 'lesson')),
	CONSTRAINT "cms_content_status_check" CHECK("cms_content"."status" in ('draft', 'published'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cms_content_kind_slug_unique` ON `cms_content` (`kind`,`slug`);--> statement-breakpoint
CREATE INDEX `cms_content_status_updated_idx` ON `cms_content` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `support_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_key` text NOT NULL,
	`reply_email` text,
	`category` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "support_requests_category_check" CHECK("support_requests"."category" in ('billing', 'technical', 'content', 'feedback', 'privacy', 'other')),
	CONSTRAINT "support_requests_status_check" CHECK("support_requests"."status" in ('open', 'in_progress', 'resolved', 'closed'))
);
--> statement-breakpoint
CREATE INDEX `support_requests_user_created_idx` ON `support_requests` (`user_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `support_requests_status_updated_idx` ON `support_requests` (`status`,`updated_at`);