-- Fixly v2, Phase 5: preventive maintenance plans and the visits they generate. Additive.

CREATE TABLE `maintenance_plans` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NULL,
    `name` VARCHAR(160) NOT NULL,
    `company_id` CHAR(36) NULL,
    `client_id` CHAR(36) NOT NULL,
    `zone_id` CHAR(36) NULL,
    `device_model_id` CHAR(36) NULL,
    `warranty_id` CHAR(36) NULL,
    `contract_id` CHAR(36) NULL,
    `frequency_days` INTEGER NOT NULL,
    `lead_days` INTEGER NOT NULL DEFAULT 7,
    `next_due_at` DATE NOT NULL,
    `last_generated_at` DATETIME(3) NULL,
    `technician_id` CHAR(36) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `notes` TEXT NULL,
    `created_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `maintenance_plans_is_active_next_due_at_idx`(`is_active`, `next_due_at`),
    INDEX `maintenance_plans_client_id_idx`(`client_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `service_visits` ADD COLUMN `maintenance_plan_id` CHAR(36) NULL,
    ADD COLUMN `client_id` CHAR(36) NULL;

CREATE INDEX `service_visits_maintenance_plan_id_idx` ON `service_visits`(`maintenance_plan_id`);

ALTER TABLE `service_visits` ADD CONSTRAINT `service_visits_maintenance_plan_id_fkey` FOREIGN KEY (`maintenance_plan_id`) REFERENCES `maintenance_plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
