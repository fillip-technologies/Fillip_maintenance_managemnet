/**
 * Document numbers: PO-2026-0001, GRN-2026-0001, TRF-…, RO-…, ISS-…, DSP-….
 * A yearly counter per prefix in `document_sequences`, incremented inside the
 * caller's transaction so a rolled-back write does not burn a number.
 */
export const NUMBER_PREFIX = {
  purchaseOrder: 'PO',
  goodsReceipt: 'GRN',
  stockTransfer: 'TRF',
  repairOrder: 'RO',
  issue: 'ISS',
  disposal: 'DSP',
};

export async function nextNumber(tx, prefix, at = new Date()) {
  const year = at.getUTCFullYear();
  await tx.$executeRaw`
    INSERT INTO document_sequences (prefix, year, last_seq) VALUES (${prefix}, ${year}, 1)
    ON DUPLICATE KEY UPDATE last_seq = last_seq + 1`;
  const [row] = await tx.$queryRaw`
    SELECT last_seq AS lastSeq FROM document_sequences WHERE prefix = ${prefix} AND year = ${year}`;
  return `${prefix}-${year}-${String(row.lastSeq).padStart(4, '0')}`;
}
