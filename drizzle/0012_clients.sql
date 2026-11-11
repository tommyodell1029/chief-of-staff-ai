CREATE TABLE `client_checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`keyword` text NOT NULL,
	`rank` integer,
	`rating` real,
	`review_count` integer,
	`leader` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `clients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`plan` text DEFAULT 'visibility' NOT NULL,
	`contact_name` text,
	`email` text,
	`city` text NOT NULL,
	`keywords` text NOT NULL,
	`website` text,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
