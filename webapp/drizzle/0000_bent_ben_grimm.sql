CREATE TABLE `datasets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`alias` text NOT NULL,
	`description` text,
	`type` text NOT NULL,
	`sourceParquetUrl` text,
	`sourceTilejsonUrl` text,
	`pmtilesUrl` text,
	`geoparquetUrl` text,
	`featureUrl` text,
	`geoserverWorkspace` text,
	`geoserverStore` text,
	`geoserverLayer` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`errorMessage` text,
	`featureCount` integer,
	`bounds` text,
	`createdAt` text DEFAULT '2025-12-18T22:16:47.255Z' NOT NULL,
	`updatedAt` text DEFAULT '2025-12-18T22:16:47.255Z' NOT NULL,
	`processedAt` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `datasets_name_unique` ON `datasets` (`name`);