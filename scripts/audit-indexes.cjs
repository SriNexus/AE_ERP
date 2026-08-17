// Static audit: order-sensitive match of composite queries against manifest.
const fs = require('fs');

const manifest = JSON.parse(fs.readFileSync('firestore.indexes.json', 'utf8'));
const byCollection = {};
for (const idx of manifest.indexes) {
  const key = idx.collectionGroup;
  byCollection[key] = byCollection[key] || [];
  byCollection[key].push(idx.fields.map(f =>
    `${f.fieldPath}${f.order === 'DESCENDING' ? '(d)' : '(a)'}${f.arrayConfig ? `[${f.arrayConfig}]` : ''}`
  ).join('|'));
}

const compositeQueries = [
  ['device_tokens', ['userId(a)', 'token(a)', 'isActive(a)']],
  ['device_tokens', ['userId(a)', 'isActive(a)']],
  ['notifications', ['companyId(a)', 'createdAt(d)']],
  ['notifications', ['companyId(a)', 'recipientUserId(a)', 'isRead(a)', 'createdAt(d)']],
  ['notifications', ['companyId(a)', 'recipientUserId(a)', 'createdAt(d)']],
  ['notifications', ['companyId(a)', 'createdBy(a)', 'createdAt(d)']],
  ['notifications', ['companyId(a)', 'visibleTo[CONTAINS]', 'createdAt(d)']],
  ['tasks', ['companyId(a)', 'assignedToId(a)', 'status(a)', 'dueDate(a)']],
  ['tasks', ['companyId(a)', 'status(a)', 'createdAt(d)']],
  ['tasks', ['companyId(a)', 'isDeleted(a)', 'linkedEntityId(a)', 'linkedEntityType(a)']],
  ['tasks', ['companyId(a)', 'isDeleted(a)', 'caseId(a)']],
  ['tasks', ['companyId(a)', 'isDeleted(a)', 'assigneeId(a)']],
  ['stock_ledger', ['companyId(a)', 'isDeleted(a)', 'createdAt(d)']],
  ['stock_ledger', ['companyId(a)', 'isDeleted(a)', 'productId(a)', 'createdAt(d)']],
  ['stock_ledger', ['companyId(a)', 'isDeleted(a)', 'warehouseId(a)', 'createdAt(d)']],
  ['stock_ledger', ['companyId(a)', 'isDeleted(a)', 'dispatchId(a)', 'createdAt(d)']],
  ['stock_ledger', ['companyId(a)', 'isDeleted(a)', 'orderId(a)', 'createdAt(d)']],
  ['stock_ledger', ['companyId(a)', 'isDeleted(a)', 'customerId(a)', 'createdAt(d)']],
  ['stock_ledger', ['companyId(a)', 'isDeleted(a)', 'sourceType(a)', 'createdAt(d)']],
  ['stock_ledger', ['companyId(a)', 'isDeleted(a)', 'sourceId(a)', 'createdAt(d)']],
  ['stock_ledger', ['companyId(a)', 'isDeleted(a)', 'movementType(a)', 'createdAt(d)']],
  ['projects', ['companyId(a)', 'currentStage(a)', 'isDeleted(a)']],
  ['projects', ['companyId(a)', 'isDeleted(a)', 'currentStage(a)']],
  ['projects', ['companyId(a)', 'assignedSurveyor(a)']],
  ['projects', ['companyId(a)', 'assignedInstaller(a)']],
  ['orders', ['companyId(a)', 'createdAt(d)']],
  ['orders', ['companyId(a)', 'isDeleted(a)', 'orderNumber(a)']],
  ['orders', ['companyId(a)', 'isDeleted(a)', 'createdAt(d)']],
  ['dispatch', ['companyId(a)', 'createdAt(d)']],
  ['dispatch', ['companyId(a)', 'isDeleted(a)', 'status(a)']],
  ['payments', ['companyId(a)', 'createdAt(d)']],
  ['payments', ['companyId(a)', 'isDeleted(a)', 'createdAt(d)']],
  ['surveys', ['companyId(a)', 'projectId(a)', 'status(a)']],
  ['surveys', ['companyId(a)', 'assignedSurveyor(a)', 'status(a)']],
  ['engineering_designs', ['companyId(a)', 'projectId(a)', 'status(a)']],
  ['engineering_designs', ['companyId(a)', 'designerId(a)', 'status(a)']],
  ['leads', ['companyId(a)', 'createdAt(d)']],
  ['leads', ['companyId(a)', 'assignedToId(a)', 'status(a)', 'createdAt(d)']],
  ['leads', ['companyId(a)', 'isDeleted(a)', 'searchName(a)']],
  ['leads', ['companyId(a)', 'isDeleted(a)', 'next_date(a)']],
  ['customers', ['companyId(a)', 'isDeleted(a)', 'searchName(a)']],
  ['products', ['companyId(a)', 'isDeleted(a)', 'searchName(a)']],
  ['quotations', ['companyId(a)', 'isDeleted(a)', 'quotationNumber(a)']],
  ['purchase_orders', ['companyId(a)', 'isDeleted(a)', 'poNumber(a)']],
  ['goods_receipts', ['companyId(a)', 'isDeleted(a)', 'grNumber(a)']],
  ['stock', ['companyId(a)', 'productId(a)', 'warehouseId(a)']],
  ['entity_relationships', ['companyId(a)', 'sourceId(a)', 'sourceType(a)', 'isDeleted(a)']],
  ['entity_relationships', ['companyId(a)', 'targetId(a)', 'targetType(a)', 'isDeleted(a)']],
  ['audit_logs', ['companyId(a)', 'isDeleted(a)', 'createdAt(d)']],
  ['audit_logs', ['companyId(a)', 'isDeleted(a)', 'severity(a)', 'createdAt(d)']],
  ['cases', ['companyId(a)', 'isDeleted(a)', 'caseId(a)']],
  ['cases', ['companyId(a)', 'isDeleted(a)', 'leadId(a)']],
  ['cases', ['companyId(a)', 'isDeleted(a)', 'customerId(a)']],
  ['cases', ['companyId(a)', 'isDeleted(a)', 'status(a)']],
  ['vendors', ['companyId(a)', 'isDeleted(a)', 'searchName(a)']],
  ['proforma_invoices', ['companyId(a)', 'isDeleted(a)', 'paymentStatus(a)']],
];

const missing = [];
for (const [col, fields] of compositeQueries) {
  const exact = fields.join('|');
  const has = (byCollection[col] || []).some(ix => ix === exact);
  if (!has) missing.push(`${col}: ${exact}`);
}
console.log('=== Composite queries with NO order-exact matching index ===');
console.log(missing.length ? missing.join('\n') : '(none)');
console.log('\n=== notifications indexes in manifest ===');
(byCollection['notifications'] || []).forEach(x => console.log('  ' + x));
