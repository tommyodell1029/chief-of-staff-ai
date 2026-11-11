CREATE TABLE `builds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client` text NOT NULL,
	`email` text,
	`status` text DEFAULT 'kickoff' NOT NULL,
	`notes` text,
	`plan` text,
	`checklist` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer,
	`launched_at` integer
);
