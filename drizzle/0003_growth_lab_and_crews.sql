CREATE TABLE `opportunities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`business_id` integer,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`scores` text NOT NULL,
	`score` real NOT NULL,
	`evidence` text NOT NULL,
	`sources` text,
	`confidence` text NOT NULL,
	`best_case` text,
	`worst_case` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`week_of` text NOT NULL,
	`package_md` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`decided_at` integer,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `agents` ADD `status` text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE `approvals` ADD `task_id` integer REFERENCES tasks(id);--> statement-breakpoint
ALTER TABLE `approvals` ADD `decision_note` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `review` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `review_verdict` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `requested_by` text DEFAULT 'jarvis' NOT NULL;