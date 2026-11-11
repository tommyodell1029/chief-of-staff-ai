CREATE TABLE `trust_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lane` text NOT NULL,
	`outcome` text NOT NULL,
	`summary` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
