-- Fixly v2, Phase 1 step 1: stop deleting a device's history with it
-- (design doc §8 rule 14, integration plan §6 change 13). Runs before any v2 write.

-- Issues and daily logs no longer cascade from devices.
ALTER TABLE `issues` DROP FOREIGN KEY `issues_device_id_fkey`;
ALTER TABLE `issues` ADD CONSTRAINT `issues_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `daily_status_logs` DROP FOREIGN KEY `daily_status_logs_device_id_fkey`;
ALTER TABLE `daily_status_logs` ADD CONSTRAINT `daily_status_logs_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Soft delete for devices.
ALTER TABLE `devices` ADD COLUMN `deleted_at` DATETIME(3) NULL;
