CREATE TABLE `learning_state` (
	`user_key` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`payload` text NOT NULL,
	`updated_at` integer NOT NULL
);
