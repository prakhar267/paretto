CREATE TABLE `native_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`apple_subject_hash` text NOT NULL,
	`email` text,
	`display_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `native_accounts_apple_subject_unique` ON `native_accounts` (`apple_subject_hash`);--> statement-breakpoint
CREATE TABLE `native_identity_token_uses` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`exchange_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `native_identity_token_uses_expiry_idx` ON `native_identity_token_uses` (`expires_at`);--> statement-breakpoint
CREATE TABLE `native_learning_state` (
	`account_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`payload` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `native_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`account_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `native_sessions_id_unique` ON `native_sessions` (`id`);--> statement-breakpoint
CREATE INDEX `native_sessions_account_idx` ON `native_sessions` (`account_id`);--> statement-breakpoint
CREATE INDEX `native_sessions_expiry_idx` ON `native_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `retention_legal_holds` (
	`id` text PRIMARY KEY NOT NULL,
	`data_class` text NOT NULL,
	`record_key` text,
	`reason` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by_email` text NOT NULL,
	`created_at` integer NOT NULL,
	`released_by_email` text,
	`released_at` integer,
	CONSTRAINT "retention_legal_holds_data_class_check" CHECK("retention_legal_holds"."data_class" in ('product_events', 'support_requests', 'admin_audit_log')),
	CONSTRAINT "retention_legal_holds_status_check" CHECK("retention_legal_holds"."status" in ('active', 'released'))
);
--> statement-breakpoint
CREATE INDEX `retention_legal_holds_status_class_idx` ON `retention_legal_holds` (`status`,`data_class`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_admin_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`from_revision` integer,
	`to_revision` integer,
	`details` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "admin_audit_entity_type_check" CHECK("entity_type" in ('content', 'support_request', 'operation', 'legal_hold'))
);
--> statement-breakpoint
INSERT INTO `__new_admin_audit_log`("id", "entity_type", "entity_id", "actor_email", "action", "from_revision", "to_revision", "details", "created_at") SELECT "id", "entity_type", "entity_id", "actor_email", "action", "from_revision", "to_revision", "details", "created_at" FROM `admin_audit_log`;--> statement-breakpoint
DROP TABLE `admin_audit_log`;--> statement-breakpoint
ALTER TABLE `__new_admin_audit_log` RENAME TO `admin_audit_log`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `admin_audit_entity_created_idx` ON `admin_audit_log` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `admin_audit_created_idx` ON `admin_audit_log` (`created_at`,`id`);
