CREATE TABLE `memberships` (
	`id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`user_id` char(26) NOT NULL,
	`role` varchar(32) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `memberships_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_memberships_tenant_user` UNIQUE(`tenant_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` char(26) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`user_id` char(26) NOT NULL,
	`tenant_id` char(26) NOT NULL,
	`ip` varchar(45),
	`user_agent` varchar(255),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`last_seen_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`expires_at` datetime(3) NOT NULL,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_sessions_token` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `tenant_overrides` (
	`tenant_id` char(26) NOT NULL,
	`key` varchar(128) NOT NULL,
	`value` json NOT NULL,
	`updated_by` char(26),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `tenant_overrides_tenant_id_key_pk` PRIMARY KEY(`tenant_id`,`key`)
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` char(26) NOT NULL,
	`name` varchar(120) NOT NULL,
	`slug` varchar(63) NOT NULL,
	`status` enum('provisioning','active','suspended','pending_deletion','deleted') NOT NULL DEFAULT 'provisioning',
	`plan` varchar(32) NOT NULL DEFAULT 'free',
	`db_name` varchar(64) NOT NULL,
	`db_user` varchar(32) NOT NULL,
	`db_password_enc` text NOT NULL,
	`data_key_enc` text NOT NULL,
	`suspended_at` datetime(3),
	`suspended_reason` varchar(255),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `tenants_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_tenants_slug` UNIQUE(`slug`),
	CONSTRAINT `uq_tenants_db_name` UNIQUE(`db_name`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` char(26) NOT NULL,
	`email` varchar(255) NOT NULL,
	`name` varchar(120) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`is_platform_admin` boolean NOT NULL DEFAULT false,
	`locale` varchar(10) NOT NULL DEFAULT 'en',
	`timezone` varchar(64) NOT NULL DEFAULT 'UTC',
	`email_verified_at` datetime(3),
	`last_login_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_users_email` UNIQUE(`email`)
);
--> statement-breakpoint
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
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenant_overrides` ADD CONSTRAINT `tenant_overrides_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_memberships_user` ON `memberships` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expires` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_ts` ON `audit_log` (`ts`);--> statement-breakpoint
CREATE INDEX `idx_audit_action` ON `audit_log` (`action`);