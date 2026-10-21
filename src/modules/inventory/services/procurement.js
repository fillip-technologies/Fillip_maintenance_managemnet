import { withTx } from '../db.js';
import { prisma } from '../../../lib/prisma.js';
import { env } from '../../../config/env.js';
import { reserveCodes } from '../../productCategories/productCategory.service.js';
import { recordLifecycleEvent } from '../domain/deviceState.js';
import { stateAtLocation } from '../domain/lifecycle.js';
import { nextNumber, NUMBER_PREFIX } from '../domain/numbers.js';
import { conflict, notFound, unprocessable } from '../http/errors.js';
import { assertVersion } from '../http/request.js';
import { enqueueNotification } from './outbox.js';

/**
 * Purchase orders and goods receipts (design doc §6 steps 1-3, rules 6, 11, 13).
 * A device record is born at receiving: one row per accepted unit, with its
 * serial, model, price, vendor, a warranty from the model's default and a
 * `received` event, all in the goods receipt's transaction.
 */
const org = () => env.FBOS_ORGANIZATION_ID ?? null;
const round2 = (n) => Math.round(n * 100) / 100;

export const poInclude = {
  vendor: { select: { id: true, name: true } },
  items: { include: { deviceModel: { select: { id: true, name: true, manufacturer: true } } }, orderBy: { createdAt: 'asc' } },
  receipts: { select: { id: true, grnNumber: true, status: true, receivedAt: true }, orderBy: { receivedAt: 'asc' } },
};

function priced(items) {
  const lines = items.map((i) => {
    const net = round2(i.quantity_ordered * i.unit_price);
    return { ...i, lineTotal: net, tax: round2((net * (i.tax_percent ?? 0)) / 100) };
  });
  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const taxTotal = round2(lines.reduce((s, l) => s + l.tax, 0));
  return { lines, subtotal, taxTotal, totalAmount: round2(subtotal + taxTotal) };
}

async function assertModels(tx, items) {
  const ids = [...new Set(items.map((i) => i.device_model_id))];
  const found = await tx.deviceModel.count({ where: { id: { in: ids }, isActive: true } });
  if (found !== ids.length) throw unprocessable('DEVICE_MODEL_NOT_FOUND', 'One of the device models does not exist or is inactive');
}

export async function createPurchaseOrder(actor, body) {
  return withTx(async (tx) => {
    const vendor = await tx.vendor.findFirst({ where: { id: body.vendor_id, isActive: true } });
    if (!vendor) throw unprocessable('VENDOR_NOT_FOUND', 'The vendor does not exist or is inactive');
    await assertModels(tx, body.items);
    const { lines, subtotal, taxTotal, totalAmount } = priced(body.items);
    return tx.purchaseOrder.create({
      data: {
        organizationId: org(),
        poNumber: await nextNumber(tx, NUMBER_PREFIX.purchaseOrder),
        vendorId: vendor.id,
        orderDate: body.order_date ? new Date(body.order_date) : new Date(),
        expectedDate: body.expected_date ? new Date(body.expected_date) : null,
        currency: body.currency ?? 'INR',
        notes: body.notes ?? null,
        subtotal,
        taxTotal,
        totalAmount,
        createdByUserId: actor.userId,
        items: {
          create: lines.map((l) => ({
            deviceModelId: l.device_model_id,
            quantityOrdered: l.quantity_ordered,
            unitPrice: l.unit_price,
            taxPercent: l.tax_percent ?? 0,
            lineTotal: l.lineTotal,
          })),
        },
      },
      include: poInclude,
    });
  });
}

async function poForUpdate(tx, id) {
  const po = await tx.purchaseOrder.findFirst({ where: { id, ...(org() ? { organizationId: org() } : {}) }, include: poInclude });
  if (!po) throw notFound('purchase order');
  return po;
}

export async function updatePurchaseOrder(actor, id, version, body) {
  return withTx(async (tx) => {
    const po = await poForUpdate(tx, id);
    assertVersion(po, version);
    if (po.status !== 'draft') throw conflict('PURCHASE_ORDER_NOT_DRAFT', 'Only a draft purchase order can be changed');
    const data = {
      ...(body.vendor_id ? { vendorId: body.vendor_id } : {}),
      ...(body.expected_date !== undefined ? { expectedDate: body.expected_date ? new Date(body.expected_date) : null } : {}),
      ...(body.order_date ? { orderDate: new Date(body.order_date) } : {}),
      ...(body.currency ? { currency: body.currency } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    };
    if (body.items) {
      await assertModels(tx, body.items);
      const { lines, subtotal, taxTotal, totalAmount } = priced(body.items);
      await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
      Object.assign(data, {
        subtotal,
        taxTotal,
        totalAmount,
        items: {
          create: lines.map((l) => ({
            deviceModelId: l.device_model_id,
            quantityOrdered: l.quantity_ordered,
            unitPrice: l.unit_price,
            taxPercent: l.tax_percent ?? 0,
            lineTotal: l.lineTotal,
          })),
        },
      });
    }
    return tx.purchaseOrder.update({ where: { id }, data: { ...data, version: { increment: 1 } }, include: poInclude });
  });
}

const PO_MOVES = {
  submit: { from: ['draft'], to: 'submitted' },
  approve: { from: ['submitted'], to: 'approved' },
  cancel: { from: ['draft', 'submitted', 'approved'], to: 'cancelled' },
};

export async function movePurchaseOrder(actor, id, version, move) {
  return withTx(async (tx) => {
    const po = await poForUpdate(tx, id);
    assertVersion(po, version);
    const rule = PO_MOVES[move];
    if (!rule.from.includes(po.status)) {
      const verb = { submit: 'submitted', approve: 'approved', cancel: 'cancelled' }[move];
      throw conflict('INVALID_PURCHASE_ORDER_STATUS', `A ${po.status} purchase order cannot be ${verb}`, { status: po.status });
    }
    if (move === 'submit' && po.items.length === 0) throw unprocessable('PURCHASE_ORDER_EMPTY', 'Add at least one line before submitting');
    if (move === 'cancel' && po.receipts.length > 0) throw conflict('PURCHASE_ORDER_HAS_RECEIPTS', 'Goods were already received against this order');
    return tx.purchaseOrder.update({
      where: { id },
      data: {
        status: rule.to,
        version: { increment: 1 },
        ...(move === 'approve' ? { approvedByUserId: actor.userId, approvedAt: new Date() } : {}),
      },
      include: poInclude,
    });
  });
}

/**
 * Goods receipt: validates quantities and serials, then creates the GRN, its
 * lines, every accepted device with its warranty and `received` event, and
 * updates the order's received quantities, in one transaction.
 */
export async function receiveGoods(actor, body) {
  return withTx(
    async (tx) => {
      const po = await poForUpdate(tx, body.purchase_order_id);
      if (!['approved', 'partially_received'].includes(po.status)) {
        throw conflict('PURCHASE_ORDER_NOT_RECEIVABLE', 'Goods can be received only against an approved order', { status: po.status });
      }
      const location = await tx.stockLocation.findFirst({ where: { id: body.receiving_location_id, isActive: true } });
      if (!location || !['platform_warehouse', 'company_store', 'client_store'].includes(location.locationType)) {
        throw unprocessable('INVALID_RECEIVING_LOCATION', 'Goods are received into a warehouse or store');
      }

      const lineById = new Map(po.items.map((i) => [i.id, i]));
      for (const item of body.items) {
        const line = lineById.get(item.purchase_order_item_id);
        if (!line) throw unprocessable('PURCHASE_ORDER_ITEM_NOT_FOUND', 'A line does not belong to this order', { purchase_order_item_id: item.purchase_order_item_id });
        if (item.quantity_accepted + item.quantity_rejected !== item.quantity_received) {
          throw unprocessable('RECEIPT_QUANTITIES_MISMATCH', 'Accepted plus rejected must equal received', { purchase_order_item_id: line.id });
        }
        if (item.units.length !== item.quantity_accepted) {
          throw unprocessable('RECEIPT_UNITS_MISMATCH', 'Give one serial number per accepted unit', {
            purchase_order_item_id: line.id, accepted: item.quantity_accepted, units: item.units.length,
          });
        }
        if (line.quantityReceived + item.quantity_accepted > line.quantityOrdered) {
          throw unprocessable('RECEIPT_EXCEEDS_ORDER', 'More units accepted than are still due on this line', {
            purchase_order_item_id: line.id, due: line.quantityOrdered - line.quantityReceived,
          });
        }
      }
      const serials = body.items.flatMap((i) => i.units.map((u) => `${lineById.get(i.purchase_order_item_id).deviceModelId}|${u.serial_number}`));
      if (new Set(serials).size !== serials.length) throw unprocessable('DUPLICATE_SERIAL', 'A serial number appears twice in this receipt');

      const accepted = body.items.reduce((n, i) => n + i.quantity_accepted, 0);
      const rejected = body.items.reduce((n, i) => n + i.quantity_rejected, 0);
      const receivedAt = new Date();
      const grn = await tx.goodsReceipt.create({
        data: {
          organizationId: org(),
          grnNumber: await nextNumber(tx, NUMBER_PREFIX.goodsReceipt),
          purchaseOrderId: po.id,
          receivingLocationId: location.id,
          vendorInvoiceNo: body.vendor_invoice_no ?? null,
          deliveryChallanNo: body.delivery_challan_no ?? null,
          status: accepted === 0 ? 'rejected' : rejected > 0 ? 'partially_accepted' : 'accepted',
          receivedAt,
          receivedByUserId: actor.userId,
          notes: body.notes ?? null,
          items: {
            create: body.items.map((i) => ({
              purchaseOrderItemId: i.purchase_order_item_id,
              quantityReceived: i.quantity_received,
              quantityAccepted: i.quantity_accepted,
              quantityRejected: i.quantity_rejected,
              rejectionReason: i.rejection_reason ?? null,
            })),
          },
        },
      });

      const state = stateAtLocation(location.locationType);
      const deviceIds = [];
      for (const item of body.items) {
        if (item.quantity_accepted === 0) continue;
        const line = lineById.get(item.purchase_order_item_id);
        const model = await tx.deviceModel.findUnique({ where: { id: line.deviceModelId } });
        if (!model.categoryId) {
          throw unprocessable('MODEL_HAS_NO_CATEGORY', `Give the model "${model.name}" a product category first: device codes come from it`);
        }
        const { codes } = await reserveCodes(tx, model.categoryId, item.units.length);
        const warrantyEnd = new Date(receivedAt);
        warrantyEnd.setUTCMonth(warrantyEnd.getUTCMonth() + model.defaultWarrantyMonths);
        for (const [i, unit] of item.units.entries()) {
          const device = await tx.device.create({
            data: {
              organizationId: org(),
              code: codes[i],
              name: model.name,
              categoryId: model.categoryId,
              productTypeId: model.productTypeId,
              hardwareTypeId: model.hardwareTypeId,
              deviceModelId: model.id,
              serialNumber: unit.serial_number,
              macAddress: unit.mac_address ?? null,
              barcode: unit.barcode ?? null,
              vendorId: po.vendorId,
              goodsReceiptId: grn.id,
              purchaseOrderItemId: line.id,
              unitPrice: line.unitPrice,
              purchaseDate: po.orderDate,
              receivedAt,
              status: 'provisioned',
              lifecycleState: state,
              currentLocationId: location.id,
              companyId: location.companyId,
              currentClientId: location.clientId,
              ownershipType: location.companyId ? env.INVENTORY_DEFAULT_OWNERSHIP : 'platform_owned',
              ownerCompanyId: location.companyId && env.INVENTORY_DEFAULT_OWNERSHIP === 'company_owned' ? location.companyId : null,
              condition: 'new',
              warrantyEndDate: model.defaultWarrantyMonths > 0 ? warrantyEnd : null,
              isManualEntry: false,
            },
          });
          if (model.defaultWarrantyMonths > 0) {
            await tx.warranty.create({
              data: {
                organizationId: org(),
                deviceId: device.id,
                vendorId: po.vendorId,
                warrantyType: 'manufacturer',
                startBasis: 'grn_date',
                startDate: receivedAt,
                endDate: warrantyEnd,
              },
            });
          }
          await recordLifecycleEvent(tx, {
            deviceId: device.id,
            eventType: 'received',
            toState: state,
            toLocationId: location.id,
            companyId: location.companyId,
            clientId: location.clientId,
            referenceType: 'goods_receipt',
            referenceId: grn.id,
            actorUserId: actor.userId,
            notes: `${grn.grnNumber} against ${po.poNumber}`,
          });
          deviceIds.push(device.id);
        }
        await tx.purchaseOrderItem.update({ where: { id: line.id }, data: { quantityReceived: { increment: item.quantity_accepted } } });
      }

      const lines = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: po.id } });
      const complete = lines.every((l) => l.quantityReceived >= l.quantityOrdered);
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: complete ? 'received' : 'partially_received', version: { increment: 1 } },
      });
      if (po.createdByUserId && deviceIds.length > 0) {
        await enqueueNotification(tx, {
          eventType: 'device.received',
          aggregateType: 'goods_receipt',
          aggregateId: grn.id,
          notify: {
            title: `${deviceIds.length} device(s) received on ${po.poNumber}`,
            body: `${grn.grnNumber} into ${location.name}${rejected ? `, ${rejected} rejected` : ''}.`,
            action_url: `/inventory/purchase-orders/${po.id}`,
            recipient_user_ids: [po.createdByUserId],
          },
        });
      }
      return { grn: await tx.goodsReceipt.findUnique({ where: { id: grn.id }, include: grnInclude }), deviceIds };
    },
    { timeout: 60_000 },
  );
}

export const grnInclude = {
  purchaseOrder: { select: { id: true, poNumber: true, vendor: { select: { id: true, name: true } } } },
  receivingLocation: { select: { id: true, name: true, locationType: true } },
  items: true,
  devices: { select: { id: true, code: true, serialNumber: true } },
};

