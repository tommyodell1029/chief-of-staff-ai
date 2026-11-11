ALTER TABLE `campaigns` ADD `send_via` text DEFAULT 'jarvis' NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `saleshandy_sequence_id` text;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `saleshandy_sequence_name` text;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `saleshandy_step_id` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `phone` text;