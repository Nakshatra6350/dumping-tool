CREATE TABLE `audit_heads` (
	`scope` varchar(16) NOT NULL,
	`last_seq` bigint unsigned NOT NULL,
	`last_hash` char(64) NOT NULL,
	CONSTRAINT `audit_heads_scope` PRIMARY KEY(`scope`)
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`seq` bigint unsigned NOT NULL,
	`id` char(26) NOT NULL,
	`ts` datetime(3) NOT NULL,
	`actor_type` varchar(16) NOT NULL,
	`actor_id` char(26),
	`actor_label` varchar(255),
	`action` varchar(96) NOT NULL,
	`target_type` varchar(48),
	`target_id` varchar(96),
	`tenant_id` char(26),
	`ip` varchar(45),
	`user_agent` varchar(255),
	`request_id` varchar(40),
	`metadata` json,
	`prev_hash` char(64) NOT NULL,
	`hash` char(64) NOT NULL,
	CONSTRAINT `audit_log_seq` PRIMARY KEY(`seq`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` varchar(128) NOT NULL,
	`value` json NOT NULL,
	`updated_by` char(26),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `storage_targets` (
	`id` char(26) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`status` enum('active','retired') NOT NULL DEFAULT 'active',
	`config` json NOT NULL,
	`secrets_enc` text NOT NULL,
	`access_key_id_hint` varchar(8) NOT NULL,
	`last_check_at` datetime(3),
	`last_check_ok` boolean,
	`last_check_detail` varchar(500),
	`created_by` char(26),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `storage_targets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_audit_ts` ON `audit_log` (`ts`);--> statement-breakpoint
CREATE INDEX `idx_audit_action` ON `audit_log` (`action`);