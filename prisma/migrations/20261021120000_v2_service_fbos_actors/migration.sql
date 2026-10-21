-- Fixly v2, Phase 4: who acted through the v2 API (FBOS users), and warranty notice tracking. Additive.

ALTER TABLE `issues` ADD COLUMN `raised_by_fbos_user_id` CHAR(36) NULL;

ALTER TABLE `issue_status_history` ADD COLUMN `changed_by_fbos_user_id` CHAR(36) NULL;

ALTER TABLE `replacement_requests` ADD COLUMN `requested_by_fbos_user_id` CHAR(36) NULL,
    ADD COLUMN `reviewed_by_fbos_user_id` CHAR(36) NULL;

ALTER TABLE `warranties` ADD COLUMN `last_notice_days` INTEGER NULL;
