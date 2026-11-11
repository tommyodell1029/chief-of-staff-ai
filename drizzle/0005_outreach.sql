CREATE TABLE `campaigns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`business_id` integer,
	`name` text NOT NULL,
	`brief` text NOT NULL,
	`preview_md` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`daily_limit` integer DEFAULT 15 NOT NULL,
	`follow_ups` integer DEFAULT 2 NOT NULL,
	`stop_reason` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`approved_at` integer,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_id` integer,
	`company` text NOT NULL,
	`domain` text NOT NULL,
	`city` text,
	`contact_name` text,
	`contact_title` text,
	`email` text,
	`email_source` text,
	`email_status` text,
	`notes` text,
	`status` text DEFAULT 'new' NOT NULL,
	`step` integer DEFAULT 0 NOT NULL,
	`thread_id` text,
	`last_sent_at` integer,
	`last_reply_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `outreach_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` integer,
	`direction` text NOT NULL,
	`kind` text NOT NULL,
	`gmail_id` text,
	`subject` text,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outreach_messages_gmail_id_unique` ON `outreach_messages` (`gmail_id`);