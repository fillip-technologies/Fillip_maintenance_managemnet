-- Fixly v2, Phase 1 step 2: additive v2 schema (design doc §7, integration plan §6).
-- Every new column on an existing table is nullable or has a default, so the v1
-- apps keep working. `devices.status` is left as is; `lifecycle_state` sits beside it.
-- The three *_flag columns are generated: their UNIQUE(device_id, flag) indexes give
-- "one open transfer / one active allocation / one active installation per device"
-- (MariaDB has no partial unique index; design doc §8 rules 2-4).


-- AlterTable
ALTER TABLE `clients` ADD COLUMN `client_code` VARCHAR(40) NULL,
    ADD COLUMN `contact_person` VARCHAR(160) NULL,
    ADD COLUMN `contact_phone` VARCHAR(40) NULL,
    ADD COLUMN `fbos_org_unit_id` CHAR(36) NULL,
    ADD COLUMN `organization_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `companies` ADD COLUMN `address` TEXT NULL,
    ADD COLUMN `company_code` VARCHAR(40) NULL,
    ADD COLUMN `contact_email` VARCHAR(200) NULL,
    ADD COLUMN `contact_name` VARCHAR(160) NULL,
    ADD COLUMN `contact_phone` VARCHAR(40) NULL,
    ADD COLUMN `fbos_customer_id` CHAR(36) NULL,
    ADD COLUMN `fbos_org_unit_id` CHAR(36) NULL,
    ADD COLUMN `gst_number` VARCHAR(20) NULL,
    ADD COLUMN `organization_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `devices` ADD COLUMN `barcode` VARCHAR(120) NULL,
    ADD COLUMN `condition` ENUM('new', 'good', 'refurbished', 'damaged', 'unknown') NULL,
    ADD COLUMN `current_client_id` CHAR(36) NULL,
    ADD COLUMN `current_location_id` CHAR(36) NULL,
    ADD COLUMN `device_model_id` CHAR(36) NULL,
    ADD COLUMN `goods_receipt_id` CHAR(36) NULL,
    ADD COLUMN `health_status` ENUM('working', 'not_working', 'needs_attention') NULL,
    ADD COLUMN `lifecycle_state` ENUM('in_platform_stock', 'reserved', 'in_transit', 'in_company_stock', 'in_client_stock', 'installed', 'under_maintenance', 'faulty', 'pending_replacement', 'under_repair', 'at_vendor_rma', 'retired', 'disposed', 'lost') NULL,
    ADD COLUMN `mac_address` VARCHAR(40) NULL,
    ADD COLUMN `organization_id` CHAR(36) NULL,
    ADD COLUMN `owner_company_id` CHAR(36) NULL,
    ADD COLUMN `ownership_type` ENUM('platform_owned', 'company_owned', 'client_owned', 'leased') NULL,
    ADD COLUMN `purchase_order_item_id` CHAR(36) NULL,
    ADD COLUMN `received_at` DATETIME(3) NULL,
    ADD COLUMN `repair_count` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `serial_number` VARCHAR(120) NULL,
    ADD COLUMN `vendor_id` CHAR(36) NULL,
    ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `warranty_end_date` DATE NULL,
    MODIFY `custom_spec` JSON NULL;

-- AlterTable
ALTER TABLE `hardware_types` MODIFY `spec_fields` JSON NOT NULL;

-- AlterTable
ALTER TABLE `issues` ADD COLUMN `approval_request_id` CHAR(36) NULL,
    ADD COLUMN `client_id` CHAR(36) NULL,
    ADD COLUMN `company_id` CHAR(36) NULL,
    ADD COLUMN `diagnosis_summary` TEXT NULL,
    ADD COLUMN `installation_id` CHAR(36) NULL,
    ADD COLUMN `issue_number` VARCHAR(30) NULL,
    ADD COLUMN `organization_id` CHAR(36) NULL,
    ADD COLUMN `raised_via` VARCHAR(20) NULL,
    ADD COLUMN `resolution_type` VARCHAR(30) NULL,
    ADD COLUMN `sla_due_at` DATETIME(3) NULL,
    ADD COLUMN `sla_policy_id` CHAR(36) NULL,
    ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `warranty_id` CHAR(36) NULL,
    ADD COLUMN `warranty_status` ENUM('in_warranty', 'out_of_warranty', 'unknown') NULL,
    ADD COLUMN `zone_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `replacement_requests` ADD COLUMN `cost_amount` DECIMAL(12, 2) NULL,
    ADD COLUMN `cost_borne_by` ENUM('customer', 'operator', 'vendor') NULL,
    ADD COLUMN `faulty_device_id` CHAR(36) NULL,
    ADD COLUMN `new_installation_id` CHAR(36) NULL,
    ADD COLUMN `old_device_disposition` VARCHAR(20) NULL,
    ADD COLUMN `organization_id` CHAR(36) NULL,
    ADD COLUMN `replacement_basis` VARCHAR(20) NULL,
    ADD COLUMN `replacement_device_id` CHAR(36) NULL,
    ADD COLUMN `source_location_id` CHAR(36) NULL,
    ADD COLUMN `stock_transfer_id` CHAR(36) NULL,
    ADD COLUMN `warranty_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `technicians` ADD COLUMN `employee_code` VARCHAR(40) NULL,
    ADD COLUMN `is_available` BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `fbos_user_id` CHAR(36) NULL,
    ADD COLUMN `last_login_at` DATETIME(3) NULL,
    ADD COLUMN `phone` VARCHAR(40) NULL;

-- CreateTable
CREATE TABLE `device_models` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NULL,
    `category_id` CHAR(36) NULL,
    `product_type_id` CHAR(36) NULL,
    `hardware_type_id` CHAR(36) NULL,
    `name` VARCHAR(160) NOT NULL,
    `manufacturer` VARCHAR(120) NOT NULL DEFAULT 'Unknown',
    `model_number` VARCHAR(120) NOT NULL,
    `default_warranty_months` INTEGER NOT NULL DEFAULT 12,
    `default_unit_price` DECIMAL(12, 2) NULL,
    `tax_percent` DECIMAL(5, 2) NULL,
    `hsn_sac` VARCHAR(20) NULL,
    `stores_data` BOOLEAN NOT NULL DEFAULT false,
    `spec_json` JSON NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `device_models_product_type_id_idx`(`product_type_id`),
    UNIQUE INDEX `device_models_manufacturer_model_number_key`(`manufacturer`, `model_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vendors` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NULL,
    `name` VARCHAR(160) NOT NULL,
    `vendor_type` ENUM('manufacturer', 'distributor', 'service_center', 'other') NOT NULL DEFAULT 'distributor',
    `contact_name` VARCHAR(160) NULL,
    `email` VARCHAR(200) NULL,
    `phone` VARCHAR(40) NULL,
    `gst_number` VARCHAR(20) NULL,
    `address` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `vendors_organization_id_idx`(`organization_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_orders` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NULL,
    `po_number` VARCHAR(30) NOT NULL,
    `vendor_id` CHAR(36) NOT NULL,
    `status` ENUM('draft', 'submitted', 'approved', 'partially_received', 'received', 'cancelled') NOT NULL DEFAULT 'draft',
    `order_date` DATE NULL,
    `expected_date` DATE NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'INR',
    `subtotal` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `tax_total` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `total_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `created_by_user_id` CHAR(36) NULL,
    `approved_by_user_id` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `approval_request_id` CHAR(36) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `purchase_orders_po_number_key`(`po_number`),
    INDEX `purchase_orders_organization_id_status_idx`(`organization_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_order_items` (
    `id` CHAR(36) NOT NULL,
    `purchase_order_id` CHAR(36) NOT NULL,
    `device_model_id` CHAR(36) NOT NULL,
    `quantity_ordered` INTEGER NOT NULL,
    `quantity_received` INTEGER NOT NULL DEFAULT 0,
    `unit_price` DECIMAL(12, 2) NOT NULL,
    `tax_percent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `line_total` DECIMAL(14, 2) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `purchase_order_items_purchase_order_id_idx`(`purchase_order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `goods_receipts` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NULL,
    `grn_number` VARCHAR(30) NOT NULL,
    `purchase_order_id` CHAR(36) NOT NULL,
    `receiving_location_id` CHAR(36) NOT NULL,
    `vendor_invoice_no` VARCHAR(60) NULL,
    `delivery_challan_no` VARCHAR(60) NULL,
    `status` ENUM('accepted', 'partially_accepted', 'rejected') NOT NULL,
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `received_by_user_id` CHAR(36) NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `goods_receipts_grn_number_key`(`grn_number`),
    INDEX `goods_receipts_purchase_order_id_idx`(`purchase_order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `goods_receipt_items` (
    `id` CHAR(36) NOT NULL,
    `goods_receipt_id` CHAR(36) NOT NULL,
    `purchase_order_item_id` CHAR(36) NOT NULL,
    `quantity_received` INTEGER NOT NULL,
    `quantity_accepted` INTEGER NOT NULL,
    `quantity_rejected` INTEGER NOT NULL DEFAULT 0,
    `rejection_reason` VARCHAR(255) NULL,

    INDEX `goods_receipt_items_goods_receipt_id_idx`(`goods_receipt_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `warranties` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NULL,
    `device_id` CHAR(36) NOT NULL,
    `vendor_id` CHAR(36) NULL,
    `warranty_type` ENUM('manufacturer', 'extended', 'amc', 'seller') NOT NULL DEFAULT 'manufacturer',
    `coverage` VARCHAR(255) NULL,
    `start_basis` VARCHAR(20) NOT NULL DEFAULT 'grn_date',
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `status` ENUM('active', 'expired', 'void') NOT NULL DEFAULT 'active',
    `contract_id` CHAR(36) NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `warranties_device_id_status_idx`(`device_id`, `status`),
    INDEX `warranties_status_end_date_idx`(`status`, `end_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_locations` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NULL,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `location_type` ENUM('platform_warehouse', 'company_store', 'client_store', 'in_transit', 'vendor', 'service_center', 'disposal') NOT NULL,
    `company_id` CHAR(36) NULL,
    `client_id` CHAR(36) NULL,
    `vendor_id` CHAR(36) NULL,
    `address` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `stock_locations_code_key`(`code`),
    INDEX `stock_locations_location_type_idx`(`location_type`),
    INDEX `stock_locations_company_id_idx`(`company_id`),
    INDEX `stock_locations_client_id_idx`(`client_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_transfers` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NULL,
    `transfer_number` VARCHAR(30) NOT NULL,
    `transfer_type` ENUM('platform_to_company', 'company_to_client', 'client_to_client', 'return_to_company', 'return_to_platform', 'replacement_dispatch', 'to_repair', 'from_repair', 'to_vendor_rma', 'from_vendor_rma') NOT NULL,
    `from_location_id` CHAR(36) NOT NULL,
    `to_location_id` CHAR(36) NOT NULL,
    `from_company_id` CHAR(36) NULL,
    `to_company_id` CHAR(36) NULL,
    `from_client_id` CHAR(36) NULL,
    `to_client_id` CHAR(36) NULL,
    `status` ENUM('draft', 'approved', 'dispatched', 'received', 'partially_received', 'rejected', 'cancelled') NOT NULL DEFAULT 'draft',
    `requested_by_user_id` CHAR(36) NULL,
    `approved_by_user_id` CHAR(36) NULL,
    `dispatched_by_user_id` CHAR(36) NULL,
    `received_by_user_id` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `dispatched_at` DATETIME(3) NULL,
    `received_at` DATETIME(3) NULL,
    `challan_no` VARCHAR(60) NULL,
    `carrier` VARCHAR(120) NULL,
    `tracking_number` VARCHAR(120) NULL,
    `notes` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `stock_transfers_transfer_number_key`(`transfer_number`),
    INDEX `stock_transfers_organization_id_status_idx`(`organization_id`, `status`),
    INDEX `stock_transfers_from_location_id_idx`(`from_location_id`),
    INDEX `stock_transfers_to_location_id_idx`(`to_location_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_transfer_items` (
    `id` CHAR(36) NOT NULL,
    `stock_transfer_id` CHAR(36) NOT NULL,
    `device_id` CHAR(36) NOT NULL,
    `condition_out` ENUM('new', 'good', 'refurbished', 'damaged', 'unknown') NULL,
    `condition_in` ENUM('new', 'good', 'refurbished', 'damaged', 'unknown') NULL,
    `item_status` ENUM('pending', 'in_transit', 'received', 'damaged', 'missing', 'cancelled') NOT NULL DEFAULT 'pending',
    `notes` TEXT NULL,
    `open_flag` TINYINT AS (IF(`item_status` IN ('pending', 'in_transit'), 1, NULL)) PERSISTENT,

    INDEX `stock_transfer_items_stock_transfer_id_idx`(`stock_transfer_id`),
    UNIQUE INDEX `stock_transfer_items_device_id_open_flag_key`(`device_id`, `open_flag`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `device_allocations` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NULL,
    `device_id` CHAR(36) NOT NULL,
    `company_id` CHAR(36) NULL,
    `client_id` CHAR(36) NULL,
    `allocation_type` ENUM('ownership', 'custody', 'loan') NOT NULL DEFAULT 'custody',
    `stock_transfer_id` CHAR(36) NULL,
    `allocated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `released_at` DATETIME(3) NULL,
    `active_flag` TINYINT AS (IF(`released_at` IS NULL, 1, NULL)) PERSISTENT,

    INDEX `device_allocations_company_id_idx`(`company_id`),
    INDEX `device_allocations_client_id_idx`(`client_id`),
    UNIQUE INDEX `device_allocations_device_id_active_flag_key`(`device_id`, `active_flag`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `device_installations` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NULL,
    `device_id` CHAR(36) NOT NULL,
    `zone_id` CHAR(36) NOT NULL,
    `client_id` CHAR(36) NULL,
    `position_label` VARCHAR(200) NULL,
    `latitude` DECIMAL(10, 8) NULL,
    `longitude` DECIMAL(11, 8) NULL,
    `installation_type` ENUM('new_install', 'replacement', 'reinstall_after_repair', 'relocation', 'imported_from_v1') NOT NULL DEFAULT 'new_install',
    `status` ENUM('active', 'removed') NOT NULL DEFAULT 'active',
    `installed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `installed_by_technician_id` CHAR(36) NULL,
    `installed_by_user_id` CHAR(36) NULL,
    `replaces_installation_id` CHAR(36) NULL,
    `removed_at` DATETIME(3) NULL,
    `removed_by_user_id` CHAR(36) NULL,
    `removal_reason` VARCHAR(255) NULL,
    `photos` JSON NULL,
    `work_unit_id` CHAR(36) NULL,
    `task_id` CHAR(36) NULL,
    `notes` TEXT NULL,
    `active_flag` TINYINT AS (IF(`status` = 'active', 1, NULL)) PERSISTENT,

    INDEX `device_installations_zone_id_status_idx`(`zone_id`, `status`),
    UNIQUE INDEX `device_installations_device_id_active_flag_key`(`device_id`, `active_flag`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `device_lifecycle_events` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NULL,
    `device_id` CHAR(36) NOT NULL,
    `event_type` VARCHAR(40) NOT NULL,
    `from_state` ENUM('in_platform_stock', 'reserved', 'in_transit', 'in_company_stock', 'in_client_stock', 'installed', 'under_maintenance', 'faulty', 'pending_replacement', 'under_repair', 'at_vendor_rma', 'retired', 'disposed', 'lost') NULL,
    `to_state` ENUM('in_platform_stock', 'reserved', 'in_transit', 'in_company_stock', 'in_client_stock', 'installed', 'under_maintenance', 'faulty', 'pending_replacement', 'under_repair', 'at_vendor_rma', 'retired', 'disposed', 'lost') NULL,
    `from_location_id` CHAR(36) NULL,
    `to_location_id` CHAR(36) NULL,
    `from_zone_id` CHAR(36) NULL,
    `to_zone_id` CHAR(36) NULL,
    `company_id` CHAR(36) NULL,
    `client_id` CHAR(36) NULL,
    `reference_type` VARCHAR(40) NULL,
    `reference_id` CHAR(36) NULL,
    `actor_user_id` CHAR(36) NULL,
    `legacy_user_id` CHAR(36) NULL,
    `notes` TEXT NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `device_lifecycle_events_device_id_occurred_at_idx`(`device_id`, `occurred_at`),
    INDEX `device_lifecycle_events_reference_type_reference_id_idx`(`reference_type`, `reference_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `device_documents` (
    `id` CHAR(36) NOT NULL,
    `device_id` CHAR(36) NOT NULL,
    `doc_type` ENUM('invoice', 'warranty_card', 'photo', 'rma_form', 'disposal_certificate', 'other') NOT NULL DEFAULT 'other',
    `document_id` CHAR(36) NULL,
    `file_url` TEXT NULL,
    `title` VARCHAR(200) NULL,
    `uploaded_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `device_documents_device_id_idx`(`device_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `device_disposals` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NULL,
    `device_id` CHAR(36) NOT NULL,
    `disposal_method` ENUM('scrap', 'sold', 'recycled', 'returned_to_vendor', 'donated') NOT NULL,
    `status` ENUM('pending', 'approved', 'rejected', 'completed') NOT NULL DEFAULT 'pending',
    `reason` TEXT NULL,
    `data_wiped` BOOLEAN NOT NULL DEFAULT false,
    `certificate_document_id` CHAR(36) NULL,
    `recovered_value` DECIMAL(12, 2) NULL,
    `requested_by_user_id` CHAR(36) NULL,
    `approved_by_user_id` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `disposed_at` DATETIME(3) NULL,
    `approval_request_id` CHAR(36) NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `device_disposals_device_id_idx`(`device_id`),
    INDEX `device_disposals_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_visits` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NULL,
    `issue_id` CHAR(36) NULL,
    `technician_id` CHAR(36) NULL,
    `visit_type` ENUM('corrective', 'preventive', 'installation', 'inspection') NOT NULL DEFAULT 'corrective',
    `status` ENUM('scheduled', 'in_progress', 'completed', 'cancelled') NOT NULL DEFAULT 'scheduled',
    `scheduled_at` DATETIME(3) NULL,
    `check_in_at` DATETIME(3) NULL,
    `check_out_at` DATETIME(3) NULL,
    `check_in_lat` DECIMAL(10, 8) NULL,
    `check_in_lng` DECIMAL(11, 8) NULL,
    `check_out_lat` DECIMAL(10, 8) NULL,
    `check_out_lng` DECIMAL(11, 8) NULL,
    `findings` TEXT NULL,
    `outcome` ENUM('fixed', 'needs_parts', 'needs_replacement', 'needs_repair', 'not_reproducible', 'other') NULL,
    `signatory_name` VARCHAR(160) NULL,
    `signature_document_id` CHAR(36) NULL,
    `created_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `service_visits_issue_id_idx`(`issue_id`),
    INDEX `service_visits_technician_id_status_idx`(`technician_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `repair_orders` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NULL,
    `repair_number` VARCHAR(30) NOT NULL,
    `device_id` CHAR(36) NOT NULL,
    `issue_id` CHAR(36) NULL,
    `warranty_id` CHAR(36) NULL,
    `vendor_id` CHAR(36) NULL,
    `repair_type` ENUM('in_house', 'service_center', 'vendor_rma') NOT NULL,
    `is_warranty_claim` BOOLEAN NOT NULL DEFAULT false,
    `rma_number` VARCHAR(60) NULL,
    `status` ENUM('requested', 'approved', 'sent', 'returned', 'closed', 'cancelled') NOT NULL DEFAULT 'requested',
    `outcome` VARCHAR(30) NULL,
    `cost_estimate` DECIMAL(12, 2) NULL,
    `final_cost` DECIMAL(12, 2) NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'INR',
    `cost_borne_by` ENUM('customer', 'operator', 'vendor') NULL,
    `billable` BOOLEAN NOT NULL DEFAULT false,
    `invoice_id` CHAR(36) NULL,
    `outbound_transfer_id` CHAR(36) NULL,
    `return_transfer_id` CHAR(36) NULL,
    `return_location_id` CHAR(36) NULL,
    `requested_by_user_id` CHAR(36) NULL,
    `approved_by_user_id` CHAR(36) NULL,
    `approval_request_id` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `sent_at` DATETIME(3) NULL,
    `returned_at` DATETIME(3) NULL,
    `closed_at` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `repair_orders_repair_number_key`(`repair_number`),
    INDEX `repair_orders_device_id_idx`(`device_id`),
    INDEX `repair_orders_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `repair_parts` (
    `id` CHAR(36) NOT NULL,
    `repair_order_id` CHAR(36) NOT NULL,
    `part_name` VARCHAR(160) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `unit_cost` DECIMAL(12, 2) NULL,
    `covered_by_warranty` BOOLEAN NOT NULL DEFAULT false,

    INDEX `repair_parts_repair_order_id_idx`(`repair_order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `outbox` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NULL,
    `event_type` VARCHAR(60) NOT NULL,
    `aggregate_type` VARCHAR(40) NOT NULL,
    `aggregate_id` CHAR(36) NOT NULL,
    `destination` VARCHAR(40) NOT NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('pending', 'delivered', 'failed') NOT NULL DEFAULT 'pending',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `next_attempt_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `delivered_at` DATETIME(3) NULL,

    INDEX `outbox_status_next_attempt_at_idx`(`status`, `next_attempt_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idempotency_keys` (
    `id` CHAR(36) NOT NULL,
    `scope` VARCHAR(200) NOT NULL,
    `key` VARCHAR(120) NOT NULL,
    `request_hash` CHAR(64) NOT NULL,
    `response_status` INTEGER NULL,
    `response_body` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `idempotency_keys_scope_key_key`(`scope`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_sequences` (
    `prefix` VARCHAR(10) NOT NULL,
    `year` INTEGER NOT NULL,
    `last_seq` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`prefix`, `year`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fbos_links` (
    `id` CHAR(36) NOT NULL,
    `entity_type` VARCHAR(40) NOT NULL,
    `entity_id` CHAR(36) NOT NULL,
    `fbos_type` VARCHAR(40) NOT NULL,
    `fbos_id` CHAR(36) NOT NULL,
    `source` VARCHAR(60) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `fbos_links_entity_type_entity_id_fbos_type_key`(`entity_type`, `entity_id`, `fbos_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `clients_client_code_key` ON `clients`(`client_code`);

-- CreateIndex
CREATE UNIQUE INDEX `clients_fbos_org_unit_id_key` ON `clients`(`fbos_org_unit_id`);

-- CreateIndex
CREATE UNIQUE INDEX `companies_company_code_key` ON `companies`(`company_code`);

-- CreateIndex
CREATE INDEX `companies_organization_id_idx` ON `companies`(`organization_id`);

-- CreateIndex
CREATE INDEX `devices_organization_id_lifecycle_state_idx` ON `devices`(`organization_id`, `lifecycle_state`);

-- CreateIndex
CREATE INDEX `devices_current_client_id_idx` ON `devices`(`current_client_id`);

-- CreateIndex
CREATE INDEX `devices_current_location_id_idx` ON `devices`(`current_location_id`);

-- CreateIndex
CREATE UNIQUE INDEX `devices_device_model_id_serial_number_key` ON `devices`(`device_model_id`, `serial_number`);

-- CreateIndex
CREATE UNIQUE INDEX `issues_issue_number_key` ON `issues`(`issue_number`);

-- CreateIndex
CREATE INDEX `issues_client_id_status_idx` ON `issues`(`client_id`, `status`);

-- CreateIndex
CREATE UNIQUE INDEX `users_fbos_user_id_key` ON `users`(`fbos_user_id`);

-- AddForeignKey
ALTER TABLE `devices` ADD CONSTRAINT `devices_device_model_id_fkey` FOREIGN KEY (`device_model_id`) REFERENCES `device_models`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devices` ADD CONSTRAINT `devices_vendor_id_fkey` FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devices` ADD CONSTRAINT `devices_goods_receipt_id_fkey` FOREIGN KEY (`goods_receipt_id`) REFERENCES `goods_receipts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devices` ADD CONSTRAINT `devices_purchase_order_item_id_fkey` FOREIGN KEY (`purchase_order_item_id`) REFERENCES `purchase_order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devices` ADD CONSTRAINT `devices_owner_company_id_fkey` FOREIGN KEY (`owner_company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devices` ADD CONSTRAINT `devices_current_client_id_fkey` FOREIGN KEY (`current_client_id`) REFERENCES `clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devices` ADD CONSTRAINT `devices_current_location_id_fkey` FOREIGN KEY (`current_location_id`) REFERENCES `stock_locations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `issues` ADD CONSTRAINT `issues_installation_id_fkey` FOREIGN KEY (`installation_id`) REFERENCES `device_installations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `issues` ADD CONSTRAINT `issues_warranty_id_fkey` FOREIGN KEY (`warranty_id`) REFERENCES `warranties`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `replacement_requests` ADD CONSTRAINT `replacement_requests_faulty_device_id_fkey` FOREIGN KEY (`faulty_device_id`) REFERENCES `devices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `replacement_requests` ADD CONSTRAINT `replacement_requests_replacement_device_id_fkey` FOREIGN KEY (`replacement_device_id`) REFERENCES `devices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `replacement_requests` ADD CONSTRAINT `replacement_requests_stock_transfer_id_fkey` FOREIGN KEY (`stock_transfer_id`) REFERENCES `stock_transfers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `replacement_requests` ADD CONSTRAINT `replacement_requests_new_installation_id_fkey` FOREIGN KEY (`new_installation_id`) REFERENCES `device_installations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device_models` ADD CONSTRAINT `device_models_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `product_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device_models` ADD CONSTRAINT `device_models_product_type_id_fkey` FOREIGN KEY (`product_type_id`) REFERENCES `product_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device_models` ADD CONSTRAINT `device_models_hardware_type_id_fkey` FOREIGN KEY (`hardware_type_id`) REFERENCES `hardware_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_vendor_id_fkey` FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_order_items` ADD CONSTRAINT `purchase_order_items_purchase_order_id_fkey` FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_order_items` ADD CONSTRAINT `purchase_order_items_device_model_id_fkey` FOREIGN KEY (`device_model_id`) REFERENCES `device_models`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `goods_receipts` ADD CONSTRAINT `goods_receipts_purchase_order_id_fkey` FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `goods_receipts` ADD CONSTRAINT `goods_receipts_receiving_location_id_fkey` FOREIGN KEY (`receiving_location_id`) REFERENCES `stock_locations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `goods_receipt_items` ADD CONSTRAINT `goods_receipt_items_goods_receipt_id_fkey` FOREIGN KEY (`goods_receipt_id`) REFERENCES `goods_receipts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `goods_receipt_items` ADD CONSTRAINT `goods_receipt_items_purchase_order_item_id_fkey` FOREIGN KEY (`purchase_order_item_id`) REFERENCES `purchase_order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `warranties` ADD CONSTRAINT `warranties_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `warranties` ADD CONSTRAINT `warranties_vendor_id_fkey` FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_locations` ADD CONSTRAINT `stock_locations_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_locations` ADD CONSTRAINT `stock_locations_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_locations` ADD CONSTRAINT `stock_locations_vendor_id_fkey` FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_transfers` ADD CONSTRAINT `stock_transfers_from_location_id_fkey` FOREIGN KEY (`from_location_id`) REFERENCES `stock_locations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_transfers` ADD CONSTRAINT `stock_transfers_to_location_id_fkey` FOREIGN KEY (`to_location_id`) REFERENCES `stock_locations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_transfer_items` ADD CONSTRAINT `stock_transfer_items_stock_transfer_id_fkey` FOREIGN KEY (`stock_transfer_id`) REFERENCES `stock_transfers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_transfer_items` ADD CONSTRAINT `stock_transfer_items_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device_allocations` ADD CONSTRAINT `device_allocations_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device_allocations` ADD CONSTRAINT `device_allocations_stock_transfer_id_fkey` FOREIGN KEY (`stock_transfer_id`) REFERENCES `stock_transfers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device_installations` ADD CONSTRAINT `device_installations_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device_installations` ADD CONSTRAINT `device_installations_zone_id_fkey` FOREIGN KEY (`zone_id`) REFERENCES `zones`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device_installations` ADD CONSTRAINT `device_installations_installed_by_technician_id_fkey` FOREIGN KEY (`installed_by_technician_id`) REFERENCES `technicians`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device_installations` ADD CONSTRAINT `device_installations_replaces_installation_id_fkey` FOREIGN KEY (`replaces_installation_id`) REFERENCES `device_installations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device_lifecycle_events` ADD CONSTRAINT `device_lifecycle_events_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device_documents` ADD CONSTRAINT `device_documents_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device_disposals` ADD CONSTRAINT `device_disposals_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_visits` ADD CONSTRAINT `service_visits_issue_id_fkey` FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_visits` ADD CONSTRAINT `service_visits_technician_id_fkey` FOREIGN KEY (`technician_id`) REFERENCES `technicians`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `repair_orders` ADD CONSTRAINT `repair_orders_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `repair_orders` ADD CONSTRAINT `repair_orders_issue_id_fkey` FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `repair_orders` ADD CONSTRAINT `repair_orders_warranty_id_fkey` FOREIGN KEY (`warranty_id`) REFERENCES `warranties`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `repair_orders` ADD CONSTRAINT `repair_orders_vendor_id_fkey` FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `repair_orders` ADD CONSTRAINT `repair_orders_outbound_transfer_id_fkey` FOREIGN KEY (`outbound_transfer_id`) REFERENCES `stock_transfers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `repair_orders` ADD CONSTRAINT `repair_orders_return_transfer_id_fkey` FOREIGN KEY (`return_transfer_id`) REFERENCES `stock_transfers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `repair_parts` ADD CONSTRAINT `repair_parts_repair_order_id_fkey` FOREIGN KEY (`repair_order_id`) REFERENCES `repair_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

