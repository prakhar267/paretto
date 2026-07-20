CREATE TABLE `product_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_key` text NOT NULL,
	`session_id` text NOT NULL,
	`event_name` text NOT NULL,
	`properties` text DEFAULT '{}' NOT NULL,
	`occurred_at` integer NOT NULL,
	`received_at` integer NOT NULL,
	CONSTRAINT "product_events_name_check" CHECK("product_events"."event_name" in ('app_opened', 'onboarding_completed', 'navigation_changed', 'lesson_started', 'lesson_completed', 'challenge_started', 'challenge_completed', 'audio_played', 'audio_fallback', 'analytics_consent_updated'))
);
--> statement-breakpoint
CREATE INDEX `product_events_name_occurred_idx` ON `product_events` (`event_name`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `product_events_user_occurred_idx` ON `product_events` (`user_key`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `product_events_received_idx` ON `product_events` (`received_at`);