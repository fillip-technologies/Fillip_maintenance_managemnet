-- CreateTable
CREATE TABLE `replacement_requests` (
    `id` CHAR(36) NOT NULL,
    `issue_id` CHAR(36) NOT NULL,
    `requested_by_user_id` CHAR(36) NULL,
    `reviewed_by_user_id` CHAR(36) NULL,
    `status` ENUM('pending', 'approved', 'rejected', 'completed', 'cancelled') NOT NULL DEFAULT 'pending',
    `reason` VARCHAR(40) NOT NULL,
    `replacement_choice` VARCHAR(20) NOT NULL,
    `spare_device_id` CHAR(36) NULL,
    `spare_device_name` VARCHAR(160) NULL,
    `spare_device_code` VARCHAR(60) NULL,
    `notes` TEXT NULL,
    `review_note` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewed_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,

    INDEX `replacement_requests_issue_id_status_idx`(`issue_id`, `status`),
    INDEX `replacement_requests_status_idx`(`status`),
    INDEX `replacement_requests_requested_by_user_id_idx`(`requested_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `replacement_requests` ADD CONSTRAINT `replacement_requests_issue_id_fkey` FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `replacement_requests` ADD CONSTRAINT `replacement_requests_requested_by_user_id_fkey` FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `replacement_requests` ADD CONSTRAINT `replacement_requests_reviewed_by_user_id_fkey` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
