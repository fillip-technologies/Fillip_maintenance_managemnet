/**
 * Permission codes for /api/inventory/v1. Each is in FBOS Identity's catalog
 * (fbos_services 01_identity/services/permission_catalog.py); the ones that show
 * prices, vendor terms, repair costs, disposals or every customer's figures are
 * in its SENSITIVE_READ_CODES, so the `member` preset never gets them.
 */
export const P = {
  DEVICE_READ: 'inventory.device.read',
  DEVICE_WRITE: 'inventory.device.write',
  SETUP_MANAGE: 'inventory.setup.manage',
  CATALOG_READ: 'inventory.catalog.read',
  CATALOG_WRITE: 'inventory.catalog.write',
  COST_READ: 'inventory.cost.read',
  PURCHASE_ORDER_READ: 'inventory.purchase_order.read',
  PURCHASE_ORDER_WRITE: 'inventory.purchase_order.write',
  PURCHASE_ORDER_APPROVE: 'inventory.purchase_order.approve',
  GOODS_RECEIPT_WRITE: 'inventory.goods_receipt.write',
  TRANSFER_READ: 'inventory.stock_transfer.read',
  TRANSFER_WRITE: 'inventory.stock_transfer.write',
  TRANSFER_APPROVE: 'inventory.stock_transfer.approve',
  TRANSFER_DISPATCH: 'inventory.stock_transfer.dispatch',
  TRANSFER_RECEIVE: 'inventory.stock_transfer.receive',
  WARRANTY_READ: 'inventory.warranty.read',
  WARRANTY_WRITE: 'inventory.warranty.write',
  ISSUE_READ: 'inventory.issue.read',
  ISSUE_WRITE: 'inventory.issue.write',
  ISSUE_ASSIGN: 'inventory.issue.assign',
  REPLACEMENT_WRITE: 'inventory.replacement.write',
  REPLACEMENT_APPROVE: 'inventory.replacement.approve',
  REPAIR_READ: 'inventory.repair_order.read',
  REPAIR_WRITE: 'inventory.repair_order.write',
  REPAIR_APPROVE: 'inventory.repair_order.approve',
  DISPOSAL_READ: 'inventory.disposal.read',
  DISPOSAL_WRITE: 'inventory.disposal.write',
  DISPOSAL_APPROVE: 'inventory.disposal.approve',
  MAINTENANCE_READ: 'inventory.maintenance_plan.read',
  MAINTENANCE_WRITE: 'inventory.maintenance_plan.write',
  REPORT_READ: 'inventory.report.read',
};
