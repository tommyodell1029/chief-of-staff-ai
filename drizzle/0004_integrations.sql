CREATE TABLE `content_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`business_id` integer,
	`platforms` text NOT NULL,
	`caption` text NOT NULL,
	`hashtags` text,
	`image_prompt` text,
	`image_file` text,
	`voiceover_text` text,
	`voiceover_file` text,
	`notes` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`posted_url` text,
	`error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`decided_at` integer,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `approvals` ADD `action` text;--> statement-breakpoint
ALTER TABLE `approvals` ADD `action_result` text;