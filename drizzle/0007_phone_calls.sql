CREATE TABLE `calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`business` text NOT NULL,
	`to_number` text NOT NULL,
	`task` text NOT NULL,
	`details` text NOT NULL,
	`opening` text NOT NULL,
	`status` text DEFAULT 'awaiting_approval' NOT NULL,
	`conversation_id` text,
	`outcome` text,
	`summary` text,
	`transcript` text,
	`error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`started_at` integer,
	`ended_at` integer
);
