CREATE TABLE `native_apple_credentials` (
	`account_id` text PRIMARY KEY NOT NULL,
	`refresh_token_ciphertext` text NOT NULL,
	`updated_at` integer NOT NULL
);
