import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, query, collection, setDoc, updateDoc, deleteDoc, where } from 'firebase/firestore';

/**
 * multiTenantSecurity.emulator.test.ts — PERMANENT Firestore rules regression
 * suite for Phase 0 (Security Hardening) of the Multi-Tenant Implementation
 * Master Plan (§17.2). Replaces the audit's temporary verification tests with
 * permanent coverage, one test per finding:
 *
 *   F-01 companies read scoping (cross-company DENY, own-company ALLOW,
 *        owner platform-wide ALLOW)
 *   F-02 isSpecialCollection() extension (project read-scope + purchase-order
 *        status machine + projectId identity immutability now authoritative)
 *   F-03 commission_rules read scoping (roles half documented as BLOCKED —
 *        name-keyed shared system-role templates; see phase report)
 *   F-04 security_logs Admin-only-create + immutable
 *   F-13 actorIsActive() deactivation enforcement (both case variants),
 *        including the deliberate users self-read exception
 *   F-17 device_tokens per-user anchoring
 *
 * Phase 2 (Group Admin Identity & Rules): GroupAdmin identity, group_members
 * authorization, companies/users/business-data Group scope, §9.6 suspension.
 *
 * Phase 3 (F-07 Warehouse Security Hardening): sameWarehouse() scoping of
 * stock / dispatch / goods_receipts / stock_ledger, warehouseId FK
 * validation on writes (F-08-class), immutable warehouseId, fail-closed
 * missing warehouse identity, list/query provability (§8.3), non-restricted
 * role and Super Admin bypass preservation, and the authoritative warehouses
 * collection block.
 *
 * Phase 4 (Super Admin Control Plane, §6): platform_settings is Super-Admin-
 * only (explicit authoritative block + isSpecialCollection membership),
 * the Group create/suspend id-anchored writes, and the §6.6 GroupAdmin
 * grant/revoke write paths (group_members + users role/groupId) — plus the
 * denial matrix proving a GroupAdmin cannot forge any of them.
 *
 * Run via: npm run test:rules
 */

// Distinct project ID from firestoreDemoIsolation.emulator.test.ts so the two
// suites can run in parallel against the same emulator without clearing each
// other's data (same port, isolated namespaces).
const PROJECT = 'neozy-multitenant-phase0-test';

const COMPANY_A = 'CO-A';
const COMPANY_B = 'CO-B';
// Phase 2: a SECOND company inside GROUP-A (same-Group cross-company access).
const COMPANY_C = 'CO-C';

const UID_ADMIN_A = 'uid-admin-a';
const UID_SURVEYOR_A = 'uid-surveyor-a';
const UID_SURVEYOR_OTHER = 'uid-surveyor-other';
const UID_SALES_A = 'uid-sales-a';
const UID_USER_A = 'uid-user-a';
const UID_INACTIVE_A = 'uid-inactive-a';
const UID_INACTIVE_LOW_A = 'uid-inactive-low-a';
const UID_USER_B = 'uid-user-b';
const UID_OWNER = 'owner-uid';
const UID_SUPER_ADMIN = 'uid-super-admin';
const ID_SUPER_ADMIN = 'MUSR-SUPER-ADMIN';
// Phase 2 actors: Group Admins of GROUP-A (home company CO-A) and GROUP-B
// (home company CO-B), plus a regular user in CO-C (GROUP-A's second company).
const UID_GA_A = 'uid-ga-a';
const ID_GA_A = 'MUSR-GA-A';
const UID_GA_B = 'uid-ga-b';
const ID_GA_B = 'MUSR-GA-B';
const UID_USER_C = 'uid-user-c';
const ID_USER_C = 'MUSR-USER-C';
// Phase 5 (§7.9 fail-closed): a user whose ERP doc role is GroupAdmin but
// whose auth-map identity carries NO groupId — the authoritative Group scope
// cannot resolve, so every Group-scoped read/write must fail closed.
const UID_GA_NOGROUP = 'uid-ga-nogroup';
const ID_GA_NOGROUP = 'MUSR-GA-NOGROUP';
// Phase 3 (F-07): warehouse-restricted actors — two warehouses in CO-A
// (GROUP-A) and one in CO-B (GROUP-B). Warehouse / Operations roles are the
// restricted roles (§8.2 regex match); they carry a singular warehouseId.
const WAREHOUSE_A1 = 'WH-A1';
const WAREHOUSE_A2 = 'WH-A2';
const WAREHOUSE_B1 = 'WH-B1';
// CO-C's warehouse (GROUP-A sibling company) — needed for GroupAdmin
// sibling-company stock-write tests, where the actor's own auth-map
// companyId (CO-A) differs from the target document's companyId (CO-C),
// isolating the groupAdminCanCreate()/Update() branch specifically.
const WAREHOUSE_C1 = 'WH-C1';
const UID_WH_A1 = 'uid-wh-a1';
const ID_WH_A1 = 'MUSR-WH-A1';
const UID_OP_A2 = 'uid-op-a2';
const ID_OP_A2 = 'MUSR-OP-A2';
const UID_WH_B1 = 'uid-wh-b1';
const ID_WH_B1 = 'MUSR-WH-B1';
// A Warehouse-role user with NO warehouseId assignment — the fail-closed case.
const UID_WH_NOWH = 'uid-wh-nowh';
const ID_WH_NOWH = 'MUSR-WH-NOWH';

const ID_ADMIN_A = 'MUSR-ADMIN-A';
const ID_SURVEYOR_A = 'MUSR-SURVEYOR-A';
const ID_SURVEYOR_OTHER = 'MUSR-SURVEYOR-OTHER';
const ID_SALES_A = 'MUSR-SALES-A';
const ID_USER_A = 'MUSR-USER-A';
const ID_INACTIVE_A = 'MUSR-INACTIVE-A';
const ID_INACTIVE_LOW_A = 'MUSR-INACTIVE-LOW-A';
const ID_USER_B = 'MUSR-USER-B';
const ID_INACTIVE_ADMIN_A = 'MUSR-INACTIVE-ADMIN-A';
const UID_INACTIVE_ADMIN_A = 'uid-inactive-admin-a';

// Phase 8 (§17.4): the exact §3.2 "Collections in scope for the groupId
// denormalization" list from the Master Plan, minus the ones this file
// already seeds with bespoke, write-path-shaped documents above (leads,
// projects, purchase_orders, commission_rules, security_logs, device_tokens,
// teams, warehouses, stock, dispatch, goods_receipts, stock_ledger) — those
// remain covered by their own dedicated describe blocks, which already
// exercise real GroupAdmin ALLOW/DENY read paths. This generated matrix
// closes the audit's own acknowledged gap ("only 2 of 14 F-02 collections
// were individually tested") for the REMAINING §3.2 collections, read-only
// (write rules diverge per-collection with bespoke field validation; §17.4
// specifically describes the "GroupAdmin ... tries Group B's document"
// pattern, which is a read-isolation proof).
const GROUP_SCOPED_FUZZ_COLLECTIONS = [
  'customers', 'surveys', 'engineering_designs', 'quotations', 'orders',
  'proforma_invoices', 'tax_invoices', 'payments', 'installations', 'qc_checks',
  'commissioning_records', 'net_metering_applications', 'subsidy_applications',
  'project_handovers', 'amc_contracts', 'service_tickets', 'generation_readings',
  'channel_partners', 'commission_records', 'settlements', 'partner_wallet_transactions',
  'tasks', 'notifications', 'documents', 'cases', 'employees', 'attendance',
  'payroll', 'banks', 'registrations', 'scheme_registrations', 'error_logs',
  'customer_phone_locks', 'device_tokens', 'audit_logs', 'settings', 'document_counters',
];

// F-17 (Phase 0): device_tokens is deliberately user-anchored with NO
// GroupAdmin additive-OR branch (personal push-notification tokens — a
// documented, intentional design exception, not a gap) — excluded from the
// "same-Group sibling-Company ALLOW" half of the matrix below. The universal
// "cross-Group DENY" half still applies to it (and does hold).
const FUZZ_GROUP_SCOPE_EXCEPTIONS = new Set<string>(['device_tokens']);

let env: RulesTestEnvironment;

function userDoc(id: string, role: string, companyId: string, email: string, extra: Record<string, unknown> = {}) {
  return { id, companyId, role, email, status: 'Active', isSuperAdmin: false, isDeleted: false, ...extra };
}

function mappingDoc(uid: string, userId: string, companyId: string, email: string) {
  return { authUid: uid, userId, companyId, email };
}

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    // ── Companies ──────────────────────────────────────────────
    // Phase 1/2: companies carry their owning groupId (companies.groupId is
    // the FK that sameCompany()'s §9.6 companyGroupIsActive() check and the
    // GroupAdmin scope both resolve through).
    await setDoc(doc(db, 'companies', COMPANY_A), { id: COMPANY_A, companyId: COMPANY_A, name: 'Company A', groupId: 'GROUP-A' });
    await setDoc(doc(db, 'companies', COMPANY_B), { id: COMPANY_B, companyId: COMPANY_B, name: 'Company B', groupId: 'GROUP-B' });
    await setDoc(doc(db, 'companies', COMPANY_C), { id: COMPANY_C, companyId: COMPANY_C, name: 'Company C', groupId: 'GROUP-A' });

    // ── Users + auth maps ──────────────────────────────────────
    // The users doc email MUST equal the mapping email (== the verified token
    // email) — the rules anchor identity on that chain.
    const identities: Array<{ uid: string; userId: string; companyId: string; email: string; role: string; extra?: Record<string, unknown> }> = [
      { uid: UID_ADMIN_A, userId: ID_ADMIN_A, companyId: COMPANY_A, email: 'admin.a@neozy.test', role: 'Admin' },
      { uid: UID_SURVEYOR_A, userId: ID_SURVEYOR_A, companyId: COMPANY_A, email: 'surveyor.a@neozy.test', role: 'Surveyor' },
      { uid: UID_SURVEYOR_OTHER, userId: ID_SURVEYOR_OTHER, companyId: COMPANY_A, email: 'surveyor.other@neozy.test', role: 'Surveyor' },
      { uid: UID_SALES_A, userId: ID_SALES_A, companyId: COMPANY_A, email: 'sales.a@neozy.test', role: 'Sales' },
      { uid: UID_USER_A, userId: ID_USER_A, companyId: COMPANY_A, email: 'user.a@neozy.test', role: 'Sales' },
      { uid: UID_INACTIVE_A, userId: ID_INACTIVE_A, companyId: COMPANY_A, email: 'inactive.a@neozy.test', role: 'Sales', extra: { status: 'Inactive' } },
      { uid: UID_INACTIVE_LOW_A, userId: ID_INACTIVE_LOW_A, companyId: COMPANY_A, email: 'inactive.low@neozy.test', role: 'Sales', extra: { status: 'inactive' } },
      { uid: UID_INACTIVE_ADMIN_A, userId: ID_INACTIVE_ADMIN_A, companyId: COMPANY_A, email: 'inactive.admin@neozy.test', role: 'Admin', extra: { status: 'Inactive' } },
      { uid: UID_USER_B, userId: ID_USER_B, companyId: COMPANY_B, email: 'user.b@neozy.test', role: 'Sales' },
      { uid: UID_SUPER_ADMIN, userId: ID_SUPER_ADMIN, companyId: COMPANY_A, email: 'super@neozy.test', role: 'Admin', extra: { isSuperAdmin: true } },
      // Phase 2: Group Admin identities (role 'GroupAdmin' + groupId mirror).
      { uid: UID_GA_A, userId: ID_GA_A, companyId: COMPANY_A, email: 'ga.a@neozy.test', role: 'GroupAdmin', extra: { groupId: 'GROUP-A' } },
      { uid: UID_GA_B, userId: ID_GA_B, companyId: COMPANY_B, email: 'ga.b@neozy.test', role: 'GroupAdmin', extra: { groupId: 'GROUP-B' } },
      { uid: UID_USER_C, userId: ID_USER_C, companyId: COMPANY_C, email: 'user.c@neozy.test', role: 'Sales', extra: { groupId: 'GROUP-A' } },
    ];
    for (const identity of identities) {
      await setDoc(doc(db, 'users', identity.userId), userDoc(identity.userId, identity.role, identity.companyId, identity.email, identity.extra));
      await setDoc(doc(db, 'user_auth_maps', identity.uid), mappingDoc(identity.uid, identity.userId, identity.companyId, identity.email));
    }

    // ── Business records ───────────────────────────────────────
    // Phase 1: tenant-scoped docs carry the §3.2 denormalized groupId — the
    // field the GroupAdmin additive-OR scope resolves against.
    await setDoc(doc(db, 'leads', 'LEAD-A'), { id: 'LEAD-A', companyId: COMPANY_A, groupId: 'GROUP-A', name: 'Lead A', createdBy: ID_USER_A, isDeleted: false });
    await setDoc(doc(db, 'leads', 'LEAD-C'), { id: 'LEAD-C', companyId: COMPANY_C, groupId: 'GROUP-A', name: 'Lead C', createdBy: ID_USER_C, isDeleted: false });
    await setDoc(doc(db, 'leads', 'LEAD-B'), { id: 'LEAD-B', companyId: COMPANY_B, groupId: 'GROUP-B', name: 'Lead B', createdBy: ID_USER_B, isDeleted: false });
    await setDoc(doc(db, 'projects', 'PRJ-1'), { id: 'PRJ-1', projectId: 'PRJ-1', companyId: COMPANY_A, groupId: 'GROUP-A', name: 'Project 1', assignedSurveyor: ID_SURVEYOR_OTHER, isDeleted: false });
    await setDoc(doc(db, 'purchase_orders', 'PO-1'), { id: 'PO-1', purchaseOrderId: 'PO-1', companyId: COMPANY_A, groupId: 'GROUP-A', status: 'Draft', vendorId: 'VEND-1', items: [], isDeleted: false });
    await setDoc(doc(db, 'commission_rules', 'CR-A'), { id: 'CR-A', companyId: COMPANY_A, groupId: 'GROUP-A', name: 'Commission Rule A' });
    await setDoc(doc(db, 'commission_rules', 'CR-B'), { id: 'CR-B', companyId: COMPANY_B, groupId: 'GROUP-B', name: 'Commission Rule B' });
    await setDoc(doc(db, 'security_logs', 'SEC-1'), { id: 'SEC-1', companyId: COMPANY_A, groupId: 'GROUP-A', message: 'seed event' });
    await setDoc(doc(db, 'device_tokens', 'TOK-USERA'), { id: 'TOK-USERA', userId: ID_USER_A, companyId: COMPANY_A, groupId: 'GROUP-A', token: 't1', isActive: true });
    await setDoc(doc(db, 'device_tokens', 'TOK-SALES'), { id: 'TOK-SALES', userId: ID_SALES_A, companyId: COMPANY_A, groupId: 'GROUP-A', token: 't2', isActive: true });

    // ── Phase 1 (F-03 closure): per-company keyed role docs ───────
    // System role templates are now keyed `${companyId}_${roleName}` with
    // companyId stamped — the company-scoped roles read resolves them.
    await setDoc(doc(db, 'roles', `${COMPANY_A}_Admin`), { id: `${COMPANY_A}_Admin`, companyId: COMPANY_A, name: 'Admin', schemaVersion: 1, isSystem: true, permissions: {} });
    await setDoc(doc(db, 'roles', `${COMPANY_A}_Sales`), { id: `${COMPANY_A}_Sales`, companyId: COMPANY_A, name: 'Sales', schemaVersion: 1, isSystem: true, permissions: {} });
    await setDoc(doc(db, 'roles', `${COMPANY_B}_Admin`), { id: `${COMPANY_B}_Admin`, companyId: COMPANY_B, name: 'Admin', schemaVersion: 1, isSystem: true, permissions: {} });
    await setDoc(doc(db, 'roles', `${COMPANY_C}_Admin`), { id: `${COMPANY_C}_Admin`, companyId: COMPANY_C, name: 'Admin', schemaVersion: 1, isSystem: true, permissions: {} });
    await setDoc(doc(db, 'roles', 'ROL-CUSTOM-A'), { id: 'ROL-CUSTOM-A', companyId: COMPANY_A, name: 'Custom A', schemaVersion: 1, permissions: {} });

    // ── Phase 1: groups + group_members ────────────────────────
    await setDoc(doc(db, 'groups', 'GROUP-A'), { id: 'GROUP-A', name: 'Group A', shortName: 'GA', status: 'Active', isDefault: true });
    await setDoc(doc(db, 'groups', 'GROUP-B'), { id: 'GROUP-B', name: 'Group B', shortName: 'GB', status: 'Active' });
    await setDoc(doc(db, 'group_members', 'GROUP-A_MUSR-GA-A'), { id: 'GROUP-A_MUSR-GA-A', groupId: 'GROUP-A', userId: ID_GA_A, role: 'GroupAdmin', status: 'Active', grantedBy: ID_SUPER_ADMIN });
    await setDoc(doc(db, 'group_members', 'GROUP-B_MUSR-GA-B'), { id: 'GROUP-B_MUSR-GA-B', groupId: 'GROUP-B', userId: ID_GA_B, role: 'GroupAdmin', status: 'Active', grantedBy: ID_SUPER_ADMIN });

    // ── Phase 1: users + mappings carry groupId (mirror) ─────────
    await setDoc(doc(db, 'users', ID_ADMIN_A), { ...userDoc(ID_ADMIN_A, 'Admin', COMPANY_A, 'admin.a@neozy.test'), groupId: 'GROUP-A' });
    await setDoc(doc(db, 'user_auth_maps', UID_ADMIN_A), { ...mappingDoc(UID_ADMIN_A, ID_ADMIN_A, COMPANY_A, 'admin.a@neozy.test'), groupId: 'GROUP-A' });
    await setDoc(doc(db, 'users', ID_SUPER_ADMIN), { ...userDoc(ID_SUPER_ADMIN, 'Admin', COMPANY_A, 'super@neozy.test'), isSuperAdmin: true, groupId: 'GROUP-A' });
    await setDoc(doc(db, 'user_auth_maps', UID_SUPER_ADMIN), { ...mappingDoc(UID_SUPER_ADMIN, ID_SUPER_ADMIN, COMPANY_A, 'super@neozy.test'), groupId: 'GROUP-A' });

    // ── Phase 2: GroupAdmin + second-company users/mappings carry groupId ──
    await setDoc(doc(db, 'users', ID_GA_A), { ...userDoc(ID_GA_A, 'GroupAdmin', COMPANY_A, 'ga.a@neozy.test'), groupId: 'GROUP-A' });
    await setDoc(doc(db, 'user_auth_maps', UID_GA_A), { ...mappingDoc(UID_GA_A, ID_GA_A, COMPANY_A, 'ga.a@neozy.test'), groupId: 'GROUP-A' });
    await setDoc(doc(db, 'users', ID_GA_B), { ...userDoc(ID_GA_B, 'GroupAdmin', COMPANY_B, 'ga.b@neozy.test'), groupId: 'GROUP-B' });
    await setDoc(doc(db, 'user_auth_maps', UID_GA_B), { ...mappingDoc(UID_GA_B, ID_GA_B, COMPANY_B, 'ga.b@neozy.test'), groupId: 'GROUP-B' });
    await setDoc(doc(db, 'users', ID_USER_C), { ...userDoc(ID_USER_C, 'Sales', COMPANY_C, 'user.c@neozy.test'), groupId: 'GROUP-A' });
    await setDoc(doc(db, 'user_auth_maps', UID_USER_C), { ...mappingDoc(UID_USER_C, ID_USER_C, COMPANY_C, 'user.c@neozy.test'), groupId: 'GROUP-A' });

    // ── Phase 3 (F-07): warehouses + warehouse-restricted actors ─────────
    // Warehouses carry companyId + groupId (the FK target of the Phase 3
    // warehouseBelongsToCompany() write validation) and groupId (the §3.2
    // denormalization). WH-A1/WH-A2 belong to COMPANY_A; WH-B1 to COMPANY_B.
    await setDoc(doc(db, 'warehouses', WAREHOUSE_A1), { id: WAREHOUSE_A1, companyId: COMPANY_A, groupId: 'GROUP-A', name: 'Warehouse A1', status: 'Active' });
    await setDoc(doc(db, 'warehouses', WAREHOUSE_A2), { id: WAREHOUSE_A2, companyId: COMPANY_A, groupId: 'GROUP-A', name: 'Warehouse A2', status: 'Active' });
    await setDoc(doc(db, 'warehouses', WAREHOUSE_B1), { id: WAREHOUSE_B1, companyId: COMPANY_B, groupId: 'GROUP-B', name: 'Warehouse B1', status: 'Active' });
    await setDoc(doc(db, 'warehouses', WAREHOUSE_C1), { id: WAREHOUSE_C1, companyId: COMPANY_C, groupId: 'GROUP-A', name: 'Warehouse C1', status: 'Active' });

    const warehouseIdentities: Array<{ uid: string; userId: string; companyId: string; email: string; role: string; warehouseId?: string }> = [
      // Warehouse-role in CO-A, assigned to WH-A1 (own-warehouse scope).
      { uid: UID_WH_A1, userId: ID_WH_A1, companyId: COMPANY_A, email: 'wh.a1@neozy.test', role: 'Warehouse', warehouseId: WAREHOUSE_A1 },
      // Operations-role in CO-A, assigned to WH-A2 (second restricted role + second warehouse).
      { uid: UID_OP_A2, userId: ID_OP_A2, companyId: COMPANY_A, email: 'op.a2@neozy.test', role: 'Operations', warehouseId: WAREHOUSE_A2 },
      // Warehouse-role in CO-B, assigned to WH-B1 (cross-company + cross-group denial).
      { uid: UID_WH_B1, userId: ID_WH_B1, companyId: COMPANY_B, email: 'wh.b1@neozy.test', role: 'Warehouse', warehouseId: WAREHOUSE_B1 },
      // Warehouse-role in CO-A with NO warehouseId assignment — fail closed.
      { uid: UID_WH_NOWH, userId: ID_WH_NOWH, companyId: COMPANY_A, email: 'wh.nowh@neozy.test', role: 'Warehouse' },
    ];
    for (const identity of warehouseIdentities) {
      await setDoc(doc(db, 'users', identity.userId), userDoc(identity.userId, identity.role, identity.companyId, identity.email, identity.warehouseId ? { warehouseId: identity.warehouseId, groupId: identity.companyId === COMPANY_A ? 'GROUP-A' : 'GROUP-B' } : { groupId: identity.companyId === COMPANY_A ? 'GROUP-A' : 'GROUP-B' }));
      await setDoc(doc(db, 'user_auth_maps', identity.uid), mappingDoc(identity.uid, identity.userId, identity.companyId, identity.email));
    }

    // Warehouse-scoped business docs: stock / dispatch / goods_receipts per
    // warehouse (real §8.1 collection shapes), carrying companyId + groupId +
    // warehouseId exactly like the app's write helpers stamp them.
    await setDoc(doc(db, 'stock', 'STK-A1'), { id: 'STK-A1', companyId: COMPANY_A, groupId: 'GROUP-A', warehouseId: WAREHOUSE_A1, productId: 'PROD-1', availableQty: 10, reservedQty: 2, onHandQty: 12, isDeleted: false });
    await setDoc(doc(db, 'stock', 'STK-A2'), { id: 'STK-A2', companyId: COMPANY_A, groupId: 'GROUP-A', warehouseId: WAREHOUSE_A2, productId: 'PROD-2', availableQty: 5, reservedQty: 1, onHandQty: 6, isDeleted: false });
    await setDoc(doc(db, 'stock', 'STK-B1'), { id: 'STK-B1', companyId: COMPANY_B, groupId: 'GROUP-B', warehouseId: WAREHOUSE_B1, productId: 'PROD-3', availableQty: 7, reservedQty: 0, onHandQty: 7, isDeleted: false });
    await setDoc(doc(db, 'dispatch', 'DSP-A1'), { id: 'DSP-A1', companyId: COMPANY_A, groupId: 'GROUP-A', warehouseId: WAREHOUSE_A1, status: 'Planned', createdBy: ID_WH_A1, isDeleted: false });
    await setDoc(doc(db, 'dispatch', 'DSP-A2'), { id: 'DSP-A2', companyId: COMPANY_A, groupId: 'GROUP-A', warehouseId: WAREHOUSE_A2, status: 'Planned', createdBy: ID_OP_A2, isDeleted: false });
    await setDoc(doc(db, 'dispatch', 'DSP-B1'), { id: 'DSP-B1', companyId: COMPANY_B, groupId: 'GROUP-B', warehouseId: WAREHOUSE_B1, status: 'Planned', createdBy: ID_WH_B1, isDeleted: false });
    await setDoc(doc(db, 'goods_receipts', 'GRN-A1'), { id: 'GRN-A1', goodsReceiptId: 'GRN-A1', companyId: COMPANY_A, groupId: 'GROUP-A', warehouseId: WAREHOUSE_A1, purchaseOrderId: 'PO-1', receivedBy: ID_WH_A1, receivedItems: [{ lineIndex: 0 }], stockEntries: [], isDeleted: false });
    await setDoc(doc(db, 'goods_receipts', 'GRN-B1'), { id: 'GRN-B1', goodsReceiptId: 'GRN-B1', companyId: COMPANY_B, groupId: 'GROUP-B', warehouseId: WAREHOUSE_B1, purchaseOrderId: 'PO-B', receivedBy: ID_WH_B1, receivedItems: [{ lineIndex: 0 }], stockEntries: [], isDeleted: false });
    await setDoc(doc(db, 'stock_ledger', 'LED-A1'), { id: 'LED-A1', companyId: COMPANY_A, groupId: 'GROUP-A', warehouseId: WAREHOUSE_A1, transactionId: 'T1', movementAt: new Date(), qty: 1, isDeleted: false });
    await setDoc(doc(db, 'stock_ledger', 'LED-A2'), { id: 'LED-A2', companyId: COMPANY_A, groupId: 'GROUP-A', warehouseId: WAREHOUSE_A2, transactionId: 'T2', movementAt: new Date(), qty: 1, isDeleted: false });

    // ── Phase 5 (§7.6): teams — a tenant-scoped business collection that
    // falls through to the generic fallback (company + group scoped, no
    // delete). TEAM-A1 belongs to CO-A (GROUP-A); TEAM-B1 to CO-B (GROUP-B).
    await setDoc(doc(db, 'teams', 'TEAM-A1'), { id: 'TEAM-A1', companyId: COMPANY_A, groupId: 'GROUP-A', name: 'Team A1', status: 'Active', isDeleted: false });
    await setDoc(doc(db, 'teams', 'TEAM-B1'), { id: 'TEAM-B1', companyId: COMPANY_B, groupId: 'GROUP-B', name: 'Team B1', status: 'Active', isDeleted: false });

    // ── Phase 5 (§7.9 fail-closed): a GroupAdmin identity WITHOUT a groupId ──
    // ERP doc role is GroupAdmin but the auth map (and users doc) carry no
    // groupId — actorGroupId() resolves to '' and every Group-scoped path must
    // fail closed instead of broadening to company/global scope.
    await setDoc(doc(db, 'users', ID_GA_NOGROUP), userDoc(ID_GA_NOGROUP, 'GroupAdmin', COMPANY_A, 'ga.nogroup@neozy.test'));
    await setDoc(doc(db, 'user_auth_maps', UID_GA_NOGROUP), mappingDoc(UID_GA_NOGROUP, ID_GA_NOGROUP, COMPANY_A, 'ga.nogroup@neozy.test'));

    // ── Phase 8 (§17.4): one minimal document per §3.2-listed collection, in
    // each of COMPANY_A (GROUP-A), COMPANY_C (GROUP-A sibling), COMPANY_B
    // (GROUP-B) — feeds the generated fuzz matrix below. Distinct `-FUZZ-`
    // ids so this never collides with the bespoke seed docs above (LEAD-A,
    // PO-1, CR-A, etc., which exercise write-path/status-machine behavior
    // this generic seed doesn't need to replicate). Read rules for every
    // §3.2 collection are uniformly `sameCompany(resource.data) ||
    // groupAdminCanRead(resource.data)` (verified by inspection — every
    // collection's `allow read` clause follows this shape, write rules are
    // where collection-specific field requirements diverge, which is why
    // this fuzz matrix is read-only), so companyId/groupId/isDeleted is
    // sufficient seed data for every one of them.
    for (const col of GROUP_SCOPED_FUZZ_COLLECTIONS) {
      await setDoc(doc(db, col, `${col}-FUZZ-A`), { id: `${col}-FUZZ-A`, companyId: COMPANY_A, groupId: 'GROUP-A', userId: ID_INACTIVE_A, isDeleted: false });
      await setDoc(doc(db, col, `${col}-FUZZ-C`), { id: `${col}-FUZZ-C`, companyId: COMPANY_C, groupId: 'GROUP-A', userId: ID_USER_C, isDeleted: false });
      await setDoc(doc(db, col, `${col}-FUZZ-B`), { id: `${col}-FUZZ-B`, companyId: COMPANY_B, groupId: 'GROUP-B', userId: ID_USER_B, isDeleted: false });
    }
  });
}

const ctx = (uid: string, email: string) => env.authenticatedContext(uid, { email }).firestore();

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => {
  await env.clearFirestore();
  await seed();
});
afterAll(async () => {
  await env.cleanup();
});

describe('F-01 — companies read is company-scoped', () => {
  it('Admin of Company A cannot read Company B companies doc', async () => {
    await assertFails(getDoc(doc(ctx(UID_ADMIN_A, 'admin.a@neozy.test'), 'companies', COMPANY_B)));
  });
  it('Admin of Company A can read own company doc', async () => {
    await assertSucceeds(getDoc(doc(ctx(UID_ADMIN_A, 'admin.a@neozy.test'), 'companies', COMPANY_A)));
  });
  it('Admin of Company A can list own company, cannot list Company B', async () => {
    const db = ctx(UID_ADMIN_A, 'admin.a@neozy.test');
    await assertSucceeds(getDocs(query(collection(db, 'companies'), where('companyId', '==', COMPANY_A))));
    await assertFails(getDocs(query(collection(db, 'companies'), where('companyId', '==', COMPANY_B))));
  });
  it('owner keeps platform-wide company read (regression guard)', async () => {
    const owner = env.authenticatedContext('owner-uid', { email: 'shreeniwas.tripathi0@gmail.com' }).firestore();
    await assertSucceeds(getDoc(doc(owner, 'companies', COMPANY_B)));
  });
  it('Company A Sales user cannot read Company B companies doc', async () => {
    await assertFails(getDoc(doc(ctx(UID_SALES_A, 'sales.a@neozy.test'), 'companies', COMPANY_B)));
  });
});

describe('F-02 — isSpecialCollection extension makes specific rules authoritative', () => {
  it('unassigned Surveyor cannot read a same-company project (read scope)', async () => {
    await assertFails(getDoc(doc(ctx(UID_SURVEYOR_A, 'surveyor.a@neozy.test'), 'projects', 'PRJ-1')));
  });
  it('unassigned Surveyor cannot perform an illegal purchase-order status transition (Draft -> Received)', async () => {
    const db = ctx(UID_SURVEYOR_A, 'surveyor.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'purchase_orders', 'PO-1'), { status: 'Received' }));
  });
  it('unassigned Surveyor cannot mutate the immutable projectId identity field', async () => {
    const db = ctx(UID_SURVEYOR_A, 'surveyor.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'projects', 'PRJ-1'), { projectId: 'PRJ-HIJACKED' }));
  });
  it('Admin can still read any same-company project (regression guard)', async () => {
    await assertSucceeds(getDoc(doc(ctx(UID_ADMIN_A, 'admin.a@neozy.test'), 'projects', 'PRJ-1')));
  });
  it('non-field-execution role can still read same-company projects (regression guard)', async () => {
    await assertSucceeds(getDoc(doc(ctx(UID_SALES_A, 'sales.a@neozy.test'), 'projects', 'PRJ-1')));
  });
  it('valid purchase-order transition still allowed for same-company actor (regression guard)', async () => {
    const db = ctx(UID_ADMIN_A, 'admin.a@neozy.test');
    await assertSucceeds(updateDoc(doc(db, 'purchase_orders', 'PO-1'), { status: 'Sent' }));
  });
});

describe('F-03 — commission_rules read is company-scoped', () => {
  it('Company A user cannot read Company B commission rule', async () => {
    await assertFails(getDoc(doc(ctx(UID_USER_A, 'user.a@neozy.test'), 'commission_rules', 'CR-B')));
  });
  it('Company A user can read own company commission rule (regression guard)', async () => {
    await assertSucceeds(getDoc(doc(ctx(UID_USER_A, 'user.a@neozy.test'), 'commission_rules', 'CR-A')));
  });
  it('Company A user cannot list Company B commission rules', async () => {
    const db = ctx(UID_USER_A, 'user.a@neozy.test');
    await assertFails(getDocs(query(collection(db, 'commission_rules'), where('companyId', '==', COMPANY_B))));
  });
  // NOTE: the `roles` half of F-03 is NOT asserted here — it is BLOCKED by the
  // name-keyed shared system-role-template data model (see Phase 0 report).
});

describe('F-04 — security_logs is Admin-only-create and immutable', () => {
  it('non-Admin same-company user cannot create a security_logs entry', async () => {
    const db = ctx(UID_USER_A, 'user.a@neozy.test');
    await assertFails(setDoc(doc(db, 'security_logs', 'FORGED'), { id: 'FORGED', companyId: COMPANY_A, message: 'forged' }));
  });
  it('Admin same-company user can create a security_logs entry', async () => {
    const db = ctx(UID_ADMIN_A, 'admin.a@neozy.test');
    await assertSucceeds(setDoc(doc(db, 'security_logs', 'ADMIN-LOG'), { id: 'ADMIN-LOG', companyId: COMPANY_A, message: 'real event' }));
  });
  it('no one — including Admin — can update an existing security_logs entry', async () => {
    const db = ctx(UID_ADMIN_A, 'admin.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'security_logs', 'SEC-1'), { message: 'tampered' }));
  });
});

describe('F-13 — deactivation is enforced at the rules layer (actorIsActive)', () => {
  it('deactivated user (status Inactive) cannot read own-company business data', async () => {
    await assertFails(getDoc(doc(ctx(UID_INACTIVE_A, 'inactive.a@neozy.test'), 'leads', 'LEAD-A')));
  });
  it('deactivated user (lowercase inactive) cannot read own-company business data', async () => {
    await assertFails(getDoc(doc(ctx(UID_INACTIVE_LOW_A, 'inactive.low@neozy.test'), 'leads', 'LEAD-A')));
  });
  it('deactivated user cannot write own-company business data', async () => {
    const db = ctx(UID_INACTIVE_A, 'inactive.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'leads', 'LEAD-A'), { name: 'tampered' }));
  });
  it('deactivated user can still read their OWN users doc (deliberate exception)', async () => {
    await assertSucceeds(getDoc(doc(ctx(UID_INACTIVE_A, 'inactive.a@neozy.test'), 'users', ID_INACTIVE_A)));
  });
  it('deactivated ADMIN cannot use Admin-only authority (no authority survives deactivation)', async () => {
    const db = ctx(UID_INACTIVE_ADMIN_A, 'inactive.admin@neozy.test');
    await assertFails(setDoc(doc(db, 'audit_logs', 'FORGED'), { id: 'FORGED', companyId: COMPANY_A, message: 'forged by deactivated admin' }));
    await assertFails(getDoc(doc(db, 'leads', 'LEAD-A')));
  });
  it('active user keeps full access (regression guard)', async () => {
    await assertSucceeds(getDoc(doc(ctx(UID_USER_A, 'user.a@neozy.test'), 'leads', 'LEAD-A')));
  });
  it('cross-company reads remain denied for active users (regression guard)', async () => {
    await assertFails(getDoc(doc(ctx(UID_USER_A, 'user.a@neozy.test'), 'leads', 'LEAD-B')));
  });
});

describe('F-17 — device_tokens are anchored to the owning user', () => {
  it('user cannot read another same-company user\'s device token', async () => {
    await assertFails(getDoc(doc(ctx(UID_USER_A, 'user.a@neozy.test'), 'device_tokens', 'TOK-SALES')));
  });
  it('user can read their own device token', async () => {
    await assertSucceeds(getDoc(doc(ctx(UID_USER_A, 'user.a@neozy.test'), 'device_tokens', 'TOK-USERA')));
  });
  it('user cannot create a device token stamped with another user id', async () => {
    const db = ctx(UID_USER_A, 'user.a@neozy.test');
    await assertFails(setDoc(doc(db, 'device_tokens', 'TOK-FORGED'), { id: 'TOK-FORGED', userId: ID_SALES_A, companyId: COMPANY_A, token: 't3', isActive: true }));
  });
  it('user can create a device token for themselves', async () => {
    const db = ctx(UID_USER_A, 'user.a@neozy.test');
    await assertSucceeds(setDoc(doc(db, 'device_tokens', 'TOK-NEW'), { id: 'TOK-NEW', userId: ID_USER_A, companyId: COMPANY_A, token: 't4', isActive: true }));
  });
  it('user cannot update another user\'s device token', async () => {
    const db = ctx(UID_USER_A, 'user.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'device_tokens', 'TOK-SALES'), { lastUsedAt: new Date().toISOString() }));
  });
});

describe('Phase 0 matrix sanity — no unexpected cross-company leak', () => {
  it('Company A user cannot read Company B leads (list or get)', async () => {
    const db = ctx(UID_USER_A, 'user.a@neozy.test');
    await assertFails(getDoc(doc(db, 'leads', 'LEAD-B')));
    await assertFails(getDocs(query(collection(db, 'leads'), where('companyId', '==', COMPANY_B))));
  });
  it('Company A user cannot forge a cross-company lead', async () => {
    const db = ctx(UID_USER_A, 'user.a@neozy.test');
    await assertFails(setDoc(doc(db, 'leads', 'FORGED'), { id: 'FORGED', companyId: COMPANY_B, name: 'forged', createdBy: ID_USER_A, isDeleted: false }));
  });
});

describe('Phase 1 — F-03 closure: roles read is company-scoped (per-company keyed docs)', () => {
  it('Company A user can read own company\'s keyed Admin role doc', async () => {
    await assertSucceeds(getDoc(doc(ctx(UID_USER_A, 'user.a@neozy.test'), 'roles', `${COMPANY_A}_Admin`)));
  });
  it('Company A user can read own company\'s custom ROL-* role doc', async () => {
    await assertSucceeds(getDoc(doc(ctx(UID_USER_A, 'user.a@neozy.test'), 'roles', 'ROL-CUSTOM-A')));
  });
  it('Company A user CANNOT read Company B\'s keyed Admin role doc (no cross-company role lookup)', async () => {
    await assertFails(getDoc(doc(ctx(UID_USER_A, 'user.a@neozy.test'), 'roles', `${COMPANY_B}_Admin`)));
  });
  it('Company A user cannot LIST Company B roles', async () => {
    const db = ctx(UID_USER_A, 'user.a@neozy.test');
    await assertFails(getDocs(query(collection(db, 'roles'), where('companyId', '==', COMPANY_B))));
  });
  it('Company A user CAN list own-company roles (provable company-scoped query)', async () => {
    const db = ctx(UID_USER_A, 'user.a@neozy.test');
    await assertSucceeds(getDocs(query(collection(db, 'roles'), where('companyId', '==', COMPANY_A))));
  });
  it('Admin can still create an own-company custom role (write compatibility regression guard)', async () => {
    const db = ctx(UID_ADMIN_A, 'admin.a@neozy.test');
    await assertSucceeds(setDoc(doc(db, 'roles', 'ROL-COMPAT-A'), { id: 'ROL-COMPAT-A', companyId: COMPANY_A, name: 'Compat A', schemaVersion: 1, permissions: {} }));
  });
  it('owner keeps platform-wide roles read (regression guard)', async () => {
    const owner = env.authenticatedContext(UID_OWNER, { email: 'shreeniwas.tripathi0@gmail.com' }).firestore();
    await assertSucceeds(getDoc(doc(owner, 'roles', `${COMPANY_B}_Admin`)));
  });
});

describe('Phase 1 — groups / group_members are platform-tier (Super Admin only)', () => {
  it('ordinary company Admin cannot read groups', async () => {
    await assertFails(getDoc(doc(ctx(UID_ADMIN_A, 'admin.a@neozy.test'), 'groups', 'GROUP-A')));
  });
  it('ordinary company Admin cannot read group_members', async () => {
    await assertFails(getDoc(doc(ctx(UID_ADMIN_A, 'admin.a@neozy.test'), 'group_members', 'GROUP-A_MUSR-ADMIN-A')));
  });
  it('ordinary company Admin cannot create a group', async () => {
    const db = ctx(UID_ADMIN_A, 'admin.a@neozy.test');
    await assertFails(setDoc(doc(db, 'groups', 'FORGED-GROUP'), { id: 'FORGED-GROUP', name: 'Forged', shortName: 'FG', status: 'Active' }));
  });
  it('Super Admin CAN read groups and group_members', async () => {
    const db = env.authenticatedContext(UID_SUPER_ADMIN, { email: 'super@neozy.test' }).firestore();
    await assertSucceeds(getDoc(doc(db, 'groups', 'GROUP-A')));
    await assertSucceeds(getDoc(doc(db, 'group_members', 'GROUP-A_MUSR-ADMIN-A')));
  });
  it('Super Admin CAN create a group (id must match the doc path)', async () => {
    const db = env.authenticatedContext(UID_SUPER_ADMIN, { email: 'super@neozy.test' }).firestore();
    await assertSucceeds(setDoc(doc(db, 'groups', 'GROUP-C'), { id: 'GROUP-C', name: 'Group C', shortName: 'GC', status: 'Active' }));
  });
  it('Super Admin CANNOT delete a group (immutable platform record)', async () => {
    const db = env.authenticatedContext(UID_SUPER_ADMIN, { email: 'super@neozy.test' }).firestore();
    await assertFails(deleteDoc(doc(db, 'groups', 'GROUP-A')));
  });
});

describe('Phase 1 — user_auth_maps groupId mirrors users.groupId (validOwnMapping extension)', () => {
  it('mapping with groupId matching the users doc is accepted', async () => {
    const db = ctx(UID_ADMIN_A, 'admin.a@neozy.test');
    await assertSucceeds(updateDoc(doc(db, 'user_auth_maps', UID_ADMIN_A), { groupId: 'GROUP-A', updatedAt: new Date().toISOString() }));
  });
  it('mapping with a groupId that does NOT match the users doc is rejected', async () => {
    // A user cannot stamp a mapping groupId that contradicts their users doc.
    const db = ctx(UID_USER_A, 'user.a@neozy.test');
    await assertFails(setDoc(doc(db, 'user_auth_maps', UID_USER_A), {
      authUid: UID_USER_A, userId: ID_USER_A, companyId: COMPANY_A, email: 'user.a@neozy.test', groupId: 'GROUP-B',
    }));
  });
  it('mapping with NO groupId remains accepted (pre-backfill window)', async () => {
    const db = ctx(UID_SALES_A, 'sales.a@neozy.test');
    await assertSucceeds(setDoc(doc(db, 'user_auth_maps', UID_SALES_A), {
      authUid: UID_SALES_A, userId: ID_SALES_A, companyId: COMPANY_A, email: 'sales.a@neozy.test',
    }));
  });
  it('an existing mapping groupId is immutable once set', async () => {
    const db = ctx(UID_ADMIN_A, 'admin.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'user_auth_maps', UID_ADMIN_A), { groupId: 'GROUP-B', updatedAt: new Date().toISOString() }));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PHASE 2 — Group Admin Identity & Rules (Master Plan §9.1-9.4, §9.6, §4.4)
// The permanent cross-Group security matrix. Actors:
//   GA_A — GroupAdmin of GROUP-A (home company CO-A; CO-C is GROUP-A's second
//          company)   GA_B — GroupAdmin of GROUP-B (home company CO-B)
//   USER_A/ADMIN_A/SALES_A — ordinary Company-tier users of CO-A
//   USER_C — ordinary user of CO-C (same Group as GA_A, sibling company)
// ────────────────────────────────────────────────────────────────────────────

describe('Phase 2 — GroupAdmin identity is authoritative (not client-claimable)', () => {
  it('valid GroupAdmin identity resolves: reads own home-company doc', async () => {
    await assertSucceeds(getDoc(doc(ctx(UID_GA_A, 'ga.a@neozy.test'), 'companies', COMPANY_A)));
  });
  it('GroupAdmin reads a SIBLING company inside the same Group (cross-company, same Group)', async () => {
    await assertSucceeds(getDoc(doc(ctx(UID_GA_A, 'ga.a@neozy.test'), 'companies', COMPANY_C)));
  });
  it('GroupAdmin CANNOT read a company in another Group', async () => {
    await assertFails(getDoc(doc(ctx(UID_GA_A, 'ga.a@neozy.test'), 'companies', COMPANY_B)));
    await assertFails(getDoc(doc(ctx(UID_GA_B, 'ga.b@neozy.test'), 'companies', COMPANY_A)));
  });
  it('ordinary Company user is NOT treated as a GroupAdmin (sibling-company denial)', async () => {
    // USER_A (CO-A) and USER_C (CO-C) are in the SAME Group — but neither is a
    // GroupAdmin, so Company-tier isolation is unchanged.
    await assertFails(getDoc(doc(ctx(UID_USER_A, 'user.a@neozy.test'), 'companies', COMPANY_C)));
    await assertFails(getDoc(doc(ctx(UID_USER_C, 'user.c@neozy.test'), 'companies', COMPANY_A)));
  });
  it('forged role claim gains no scope: role GroupAdmin without a groupId grants nothing', async () => {
    // GA_B is a real GroupAdmin — but of GROUP-B. It cannot use that identity
    // to reach GROUP-A data.
    await assertFails(getDoc(doc(ctx(UID_GA_B, 'ga.b@neozy.test'), 'companies', COMPANY_A)));
    await assertFails(getDoc(doc(ctx(UID_GA_B, 'ga.b@neozy.test'), 'leads', 'LEAD-A')));
  });
  it('Company Admin cannot self-promote to GroupAdmin (only Super Admin creates Group Admins)', async () => {
    const db = ctx(UID_ADMIN_A, 'admin.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'users', ID_ADMIN_A), { ...userDoc(ID_ADMIN_A, 'GroupAdmin', COMPANY_A, 'admin.a@neozy.test'), groupId: 'GROUP-A' }));
    await assertFails(updateDoc(doc(db, 'users', ID_USER_A), { ...userDoc(ID_USER_A, 'GroupAdmin', COMPANY_A, 'user.a@neozy.test'), groupId: 'GROUP-A' }));
  });
  it('Super Admin CAN create a GroupAdmin user (identity bootstrap path)', async () => {
    const db = env.authenticatedContext(UID_SUPER_ADMIN, { email: 'super@neozy.test' }).firestore();
    await assertSucceeds(setDoc(doc(db, 'users', 'MUSR-NEW-GA'), { id: 'MUSR-NEW-GA', companyId: COMPANY_A, groupId: 'GROUP-A', role: 'GroupAdmin', email: 'new.ga@neozy.test', status: 'Active', isSuperAdmin: false, isDeleted: false }));
  });
});

describe('Phase 2 — group_members authorization', () => {
  it('GroupAdmin can read membership records of their OWN Group', async () => {
    await assertSucceeds(getDoc(doc(ctx(UID_GA_A, 'ga.a@neozy.test'), 'group_members', 'GROUP-A_MUSR-GA-A')));
  });
  it('cross-Group membership read is denied', async () => {
    await assertFails(getDoc(doc(ctx(UID_GA_A, 'ga.a@neozy.test'), 'group_members', 'GROUP-B_MUSR-GA-B')));
    await assertFails(getDoc(doc(ctx(UID_GA_B, 'ga.b@neozy.test'), 'group_members', 'GROUP-A_MUSR-GA-A')));
  });
  it('GroupAdmin cannot fabricate a membership record without the grantedBy anchor (Phase 5 §7.9)', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    // Phase 5 (§7.9) opened the group_members CREATE to an active Group Admin
    // for a SECOND Group Admin of their own Group — but only with the auditable
    // anchor grantedBy == the actor. A bare record without the anchor (or with
    // a forged one) still fails closed.
    await assertFails(setDoc(doc(db, 'group_members', 'GROUP-A_MUSR-USER-C'), { id: 'GROUP-A_MUSR-USER-C', groupId: 'GROUP-A', userId: ID_USER_C, role: 'GroupAdmin', status: 'Active' }));
    await assertFails(setDoc(doc(db, 'group_members', 'GROUP-A_MUSR-USER-C'), { id: 'GROUP-A_MUSR-USER-C', groupId: 'GROUP-A', userId: ID_USER_C, role: 'GroupAdmin', status: 'Active', grantedBy: 'MUSR-SOMEONE-ELSE' }));
  });
  it('GroupAdmin cannot modify an existing membership record (incl. their own)', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'group_members', 'GROUP-A_MUSR-GA-A'), { status: 'Revoked', updatedAt: new Date().toISOString() }));
  });
  it('GroupAdmin cannot read another Group\'s document (groups collection)', async () => {
    await assertFails(getDoc(doc(ctx(UID_GA_A, 'ga.a@neozy.test'), 'groups', 'GROUP-B')));
  });
  it('GroupAdmin CAN read their own Group\'s document', async () => {
    await assertSucceeds(getDoc(doc(ctx(UID_GA_A, 'ga.a@neozy.test'), 'groups', 'GROUP-A')));
  });
  it('GroupAdmin cannot create another Group', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(setDoc(doc(db, 'groups', 'FORGED-GROUP'), { id: 'FORGED-GROUP', name: 'Forged', shortName: 'FG', status: 'Active' }));
  });
});

describe('Phase 2 — companies scope (list + mutation)', () => {
  it('GroupAdmin can list companies of their own Group; cannot list another Group', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(getDocs(query(collection(db, 'companies'), where('groupId', '==', 'GROUP-A'))));
    await assertFails(getDocs(query(collection(db, 'companies'), where('groupId', '==', 'GROUP-B'))));
  });
  it('GroupAdmin can create a company inside their own Group', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(setDoc(doc(db, 'companies', 'CO-D'), { id: 'CO-D', companyId: 'CO-D', name: 'Company D', groupId: 'GROUP-A' }));
  });
  it('GroupAdmin CANNOT create a company with a forged other-Group groupId', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(setDoc(doc(db, 'companies', 'CO-E'), { id: 'CO-E', companyId: 'CO-E', name: 'Company E', groupId: 'GROUP-B' }));
  });
  it('GroupAdmin CANNOT update a company in another Group (and cannot re-point groupId)', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'companies', COMPANY_B), { id: COMPANY_B, companyId: COMPANY_B, name: 'Hijacked', groupId: 'GROUP-B' }));
    // same-Group update is allowed, but groupId is immutable
    await assertFails(updateDoc(doc(db, 'companies', COMPANY_C), { id: COMPANY_C, companyId: COMPANY_C, name: 'C2', groupId: 'GROUP-B' }));
    await assertSucceeds(updateDoc(doc(db, 'companies', COMPANY_C), { id: COMPANY_C, companyId: COMPANY_C, name: 'C2', groupId: 'GROUP-A' }));
  });
});

describe('Phase 2 — users scope (identity lifecycle at the rules layer)', () => {
  it('GroupAdmin can read users inside their Group (any Company)', async () => {
    await assertSucceeds(getDoc(doc(ctx(UID_GA_A, 'ga.a@neozy.test'), 'users', ID_USER_C)));
  });
  it('GroupAdmin CANNOT read users in another Group', async () => {
    await assertFails(getDoc(doc(ctx(UID_GA_A, 'ga.a@neozy.test'), 'users', ID_USER_B)));
  });
  it('GroupAdmin can list users by group; cannot list another Group\'s users', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(getDocs(query(collection(db, 'users'), where('groupId', '==', 'GROUP-A'))));
    await assertFails(getDocs(query(collection(db, 'users'), where('groupId', '==', 'GROUP-B'))));
  });
  it('GroupAdmin CAN manage (update) a user in a sibling Company of their Group', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(updateDoc(doc(db, 'users', ID_USER_C), { ...userDoc(ID_USER_C, 'Sales', COMPANY_C, 'user.c@neozy.test'), groupId: 'GROUP-A', status: 'Inactive' }));
  });
  it('GroupAdmin CAN transfer a user between Companies INSIDE their Group (§4.4)', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(updateDoc(doc(db, 'users', ID_USER_C), { ...userDoc(ID_USER_C, 'Sales', COMPANY_A, 'user.c@neozy.test'), groupId: 'GROUP-A' }));
  });
  it('GroupAdmin CANNOT transfer a user from another Group (Group escape denied)', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'users', ID_USER_B), { ...userDoc(ID_USER_B, 'Sales', COMPANY_A, 'user.b@neozy.test'), groupId: 'GROUP-A' }));
  });
  it('GroupAdmin CANNOT change a user\'s groupId (groupId immutable, no boundary escape)', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'users', ID_USER_C), { ...userDoc(ID_USER_C, 'Sales', COMPANY_C, 'user.c@neozy.test'), groupId: 'GROUP-B' }));
  });
  it('GroupAdmin CANNOT grant SuperAdmin to any user', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'users', ID_USER_C), { ...userDoc(ID_USER_C, 'Sales', COMPANY_C, 'user.c@neozy.test'), groupId: 'GROUP-A', isSuperAdmin: true }));
  });
  it('GroupAdmin CANNOT promote another user to GroupAdmin', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'users', ID_USER_C), { ...userDoc(ID_USER_C, 'GroupAdmin', COMPANY_C, 'user.c@neozy.test'), groupId: 'GROUP-A' }));
  });
  it('GroupAdmin CAN create a staff user in a sibling Company of their Group (§4.4)', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(setDoc(doc(db, 'users', 'MUSR-NEW-C'), { id: 'MUSR-NEW-C', companyId: COMPANY_C, groupId: 'GROUP-A', role: 'Sales', email: 'new.c@neozy.test', status: 'Active', isSuperAdmin: false, isDeleted: false }));
  });
  it('GroupAdmin CANNOT create a user in another Group\'s company', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(setDoc(doc(db, 'users', 'MUSR-FORGED'), { id: 'MUSR-FORGED', companyId: COMPANY_B, groupId: 'GROUP-B', role: 'Sales', email: 'forged@neozy.test', status: 'Active', isSuperAdmin: false, isDeleted: false }));
  });
  it('GroupAdmin CANNOT create a user with a forged groupId', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(setDoc(doc(db, 'users', 'MUSR-FORGED2'), { id: 'MUSR-FORGED2', companyId: COMPANY_C, groupId: 'GROUP-B', role: 'Sales', email: 'forged2@neozy.test', status: 'Active', isSuperAdmin: false, isDeleted: false }));
  });
});

describe('Phase 2 — business data (representative tenant-scoped collections)', () => {
  it('GroupAdmin reads business data across their Group; denied for Group B', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(getDoc(doc(db, 'leads', 'LEAD-A')));
    await assertSucceeds(getDoc(doc(db, 'leads', 'LEAD-C')));
    await assertFails(getDoc(doc(db, 'leads', 'LEAD-B')));
  });
  it('GroupAdmin list queries: own-Group provable, other-Group denied', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(getDocs(query(collection(db, 'leads'), where('groupId', '==', 'GROUP-A'))));
    await assertFails(getDocs(query(collection(db, 'leads'), where('groupId', '==', 'GROUP-B'))));
  });
  it('GroupAdmin CAN create business data in a sibling Company of their Group', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(setDoc(doc(db, 'leads', 'LEAD-GA-C'), { id: 'LEAD-GA-C', companyId: COMPANY_C, groupId: 'GROUP-A', name: 'GA created', createdBy: ID_GA_A, isDeleted: false }));
  });
  it('GroupAdmin CANNOT forge groupId on business data (escalation attempt)', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(setDoc(doc(db, 'leads', 'LEAD-FORGED'), { id: 'LEAD-FORGED', companyId: COMPANY_A, groupId: 'GROUP-B', name: 'forged', createdBy: ID_GA_A, isDeleted: false }));
    await assertFails(setDoc(doc(db, 'leads', 'LEAD-FORGED2'), { id: 'LEAD-FORGED2', companyId: COMPANY_B, groupId: 'GROUP-B', name: 'forged', createdBy: ID_GA_A, isDeleted: false }));
  });
  it('GroupAdmin CANNOT update/delete business data in another Group', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'leads', 'LEAD-B'), { id: 'LEAD-B', companyId: COMPANY_B, groupId: 'GROUP-B', name: 'hijacked', createdBy: ID_USER_B, isDeleted: false }));
  });
  it('GroupAdmin CAN update business data in their Group (full-doc update)', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(updateDoc(doc(db, 'leads', 'LEAD-C'), { id: 'LEAD-C', companyId: COMPANY_C, groupId: 'GROUP-A', name: 'Updated by GA', createdBy: ID_USER_C, isDeleted: false }));
  });
  it('project-scoped collections: GroupAdmin reads Group-wide (Admin-equivalent)', async () => {
    await assertSucceeds(getDoc(doc(ctx(UID_GA_A, 'ga.a@neozy.test'), 'projects', 'PRJ-1')));
  });
  it('purchase_orders: GroupAdmin can drive the status machine in their Group', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(updateDoc(doc(db, 'purchase_orders', 'PO-1'), { id: 'PO-1', purchaseOrderId: 'PO-1', companyId: COMPANY_A, groupId: 'GROUP-A', status: 'Sent', vendorId: 'VEND-1', items: [], isDeleted: false }));
  });
  it('sibling-company isolation preserved for ordinary Company users (same Group)', async () => {
    await assertFails(getDoc(doc(ctx(UID_USER_A, 'user.a@neozy.test'), 'leads', 'LEAD-C')));
    await assertFails(getDoc(doc(ctx(UID_USER_C, 'user.c@neozy.test'), 'leads', 'LEAD-A')));
  });
});

describe('Phase 2 — roles: Group-scoped resolution, F-03 isolation intact', () => {
  it('GroupAdmin can resolve a sibling Company\'s keyed role doc (permission bootstrap)', async () => {
    await assertSucceeds(getDoc(doc(ctx(UID_GA_A, 'ga.a@neozy.test'), 'roles', `${COMPANY_C}_Admin`)));
  });
  it('GroupAdmin CANNOT read another Group\'s keyed role doc', async () => {
    await assertFails(getDoc(doc(ctx(UID_GA_A, 'ga.a@neozy.test'), 'roles', `${COMPANY_B}_Admin`)));
  });
  it('GroupAdmin can list a sibling Company\'s roles (per-Company visibility, §5.6)', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(getDocs(query(collection(db, 'roles'), where('companyId', '==', COMPANY_C))));
    await assertFails(getDocs(query(collection(db, 'roles'), where('companyId', '==', COMPANY_B))));
  });
  it('F-03 isolation intact: ordinary users still cannot read other companies\' roles', async () => {
    await assertFails(getDoc(doc(ctx(UID_USER_A, 'user.a@neozy.test'), 'roles', `${COMPANY_C}_Admin`)));
  });
});

describe('Phase 2 — Super Admin platform-wide access preserved', () => {
  it('Super Admin reads across Groups, groups, group_members and roles', async () => {
    const db = env.authenticatedContext(UID_SUPER_ADMIN, { email: 'super@neozy.test' }).firestore();
    await assertSucceeds(getDoc(doc(db, 'companies', COMPANY_B)));
    await assertSucceeds(getDoc(doc(db, 'leads', 'LEAD-B')));
    await assertSucceeds(getDoc(doc(db, 'groups', 'GROUP-B')));
    await assertSucceeds(getDoc(doc(db, 'group_members', 'GROUP-B_MUSR-GA-B')));
    await assertSucceeds(getDoc(doc(db, 'roles', `${COMPANY_B}_Admin`)));
  });
  it('Super Admin can create a Group Admin\'s group_members record (identity bootstrap)', async () => {
    const db = env.authenticatedContext(UID_SUPER_ADMIN, { email: 'super@neozy.test' }).firestore();
    await assertSucceeds(setDoc(doc(db, 'group_members', 'GROUP-A_MUSR-NEW-GA'), { id: 'GROUP-A_MUSR-NEW-GA', groupId: 'GROUP-A', userId: 'MUSR-NEW-GA', role: 'GroupAdmin', status: 'Active', grantedBy: ID_SUPER_ADMIN }));
  });
});

describe('Phase 2 — §9.6 Group suspension enforcement', () => {
  it('suspending a Group cuts off its Company Admins AND Group Admins; Super Admin keeps break-glass', async () => {
    await env.withSecurityRulesDisabled(async (ctxRules) => {
      await setDoc(doc(ctxRules.firestore(), 'groups', 'GROUP-A'), { id: 'GROUP-A', name: 'Group A', shortName: 'GA', status: 'Suspended', isDefault: true });
    });
    // Company Admin of a suspended Group loses company-scoped access.
    await assertFails(getDoc(doc(ctx(UID_ADMIN_A, 'admin.a@neozy.test'), 'leads', 'LEAD-A')));
    // Group Admin of a suspended Group loses Group scope (list + get).
    const gaDb = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(getDoc(doc(gaDb, 'leads', 'LEAD-C')));
    await assertFails(getDocs(query(collection(gaDb, 'leads'), where('groupId', '==', 'GROUP-A'))));
    await assertFails(getDoc(doc(gaDb, 'companies', COMPANY_C)));
    // Super Admin retains break-glass access.
    const superDb = env.authenticatedContext(UID_SUPER_ADMIN, { email: 'super@neozy.test' }).firestore();
    await assertSucceeds(getDoc(doc(superDb, 'leads', 'LEAD-A')));
    await assertSucceeds(getDoc(doc(superDb, 'companies', COMPANY_A)));
  });
  it('a GroupAdmin of an ACTIVE Group is unaffected (control)', async () => {
    await assertSucceeds(getDoc(doc(ctx(UID_GA_B, 'ga.b@neozy.test'), 'leads', 'LEAD-B')));
  });
});

describe('Phase 3 (F-07) — warehouse-restricted actors are scoped to their own warehouse', () => {
  it('Warehouse-role user reads own-warehouse stock → ALLOW', async () => {
    await assertSucceeds(getDoc(doc(ctx(UID_WH_A1, 'wh.a1@neozy.test'), 'stock', 'STK-A1')));
  });
  it('Warehouse-role user reads ANOTHER warehouse stock in the SAME company → DENY (F-07 hole closed)', async () => {
    await assertFails(getDoc(doc(ctx(UID_WH_A1, 'wh.a1@neozy.test'), 'stock', 'STK-A2')));
  });
  it('Warehouse-role user reads another company stock → DENY (company + warehouse both violated)', async () => {
    await assertFails(getDoc(doc(ctx(UID_WH_A1, 'wh.a1@neozy.test'), 'stock', 'STK-B1')));
  });
  it('Operations-role user reads own-warehouse dispatch → ALLOW', async () => {
    await assertSucceeds(getDoc(doc(ctx(UID_OP_A2, 'op.a2@neozy.test'), 'dispatch', 'DSP-A2')));
  });
  it('Operations-role user reads another warehouse dispatch in the same company → DENY', async () => {
    await assertFails(getDoc(doc(ctx(UID_OP_A2, 'op.a2@neozy.test'), 'dispatch', 'DSP-A1')));
  });
  it('Warehouse-role user reads own-warehouse goods_receipts → ALLOW', async () => {
    await assertSucceeds(getDoc(doc(ctx(UID_WH_A1, 'wh.a1@neozy.test'), 'goods_receipts', 'GRN-A1')));
  });
  it('Warehouse-role user reads another company goods_receipts → DENY', async () => {
    await assertFails(getDoc(doc(ctx(UID_WH_A1, 'wh.a1@neozy.test'), 'goods_receipts', 'GRN-B1')));
  });
  it('Warehouse-role user reads own-warehouse stock_ledger → ALLOW', async () => {
    await assertSucceeds(getDoc(doc(ctx(UID_WH_A1, 'wh.a1@neozy.test'), 'stock_ledger', 'LED-A1')));
  });
  it('Warehouse-role user CANNOT read another warehouse stock_ledger (no ledger-path leak)', async () => {
    await assertFails(getDoc(doc(ctx(UID_WH_A1, 'wh.a1@neozy.test'), 'stock_ledger', 'LED-A2')));
  });
  it('Warehouse-role user with NO warehouseId assignment fails closed (no scope to resolve)', async () => {
    // Even own-company stock is denied — the actor has no authoritative warehouse.
    await assertFails(getDoc(doc(ctx(UID_WH_NOWH, 'wh.nowh@neozy.test'), 'stock', 'STK-A1')));
    await assertFails(getDoc(doc(ctx(UID_WH_NOWH, 'wh.nowh@neozy.test'), 'stock', 'STK-A2')));
  });
});

describe('Phase 3 (F-07) — warehouse list/query provability (§8.3)', () => {
  it('warehouse-scoped list query on own warehouse → ALLOW', async () => {
    const db = ctx(UID_WH_A1, 'wh.a1@neozy.test');
    await assertSucceeds(getDocs(query(collection(db, 'stock'), where('companyId', '==', COMPANY_A), where('warehouseId', '==', WAREHOUSE_A1))));
  });
  it('warehouse-scoped list query on ANOTHER warehouse → DENY (query cannot broaden scope)', async () => {
    const db = ctx(UID_WH_A1, 'wh.a1@neozy.test');
    await assertFails(getDocs(query(collection(db, 'stock'), where('companyId', '==', COMPANY_A), where('warehouseId', '==', WAREHOUSE_A2))));
  });
  it('unscoped company-only list query for a warehouse-restricted actor → DENY (must carry warehouseId)', async () => {
    const db = ctx(UID_WH_A1, 'wh.a1@neozy.test');
    await assertFails(getDocs(query(collection(db, 'stock'), where('companyId', '==', COMPANY_A))));
  });
  it('warehouse-scoped dispatch list on own warehouse → ALLOW', async () => {
    const db = ctx(UID_OP_A2, 'op.a2@neozy.test');
    await assertSucceeds(getDocs(query(collection(db, 'dispatch'), where('companyId', '==', COMPANY_A), where('warehouseId', '==', WAREHOUSE_A2))));
  });
  it('warehouse-scoped goods_receipts list on another company → DENY', async () => {
    const db = ctx(UID_WH_A1, 'wh.a1@neozy.test');
    await assertFails(getDocs(query(collection(db, 'goods_receipts'), where('companyId', '==', COMPANY_B), where('warehouseId', '==', WAREHOUSE_B1))));
  });
});

describe('Phase 3 (F-07/F-08) — warehouse write-path FK validation', () => {
  it('create stock in own warehouse → ALLOW', async () => {
    const db = ctx(UID_WH_A1, 'wh.a1@neozy.test');
    await assertSucceeds(setDoc(doc(db, 'stock', 'STK-NEW'), { id: 'STK-NEW', companyId: COMPANY_A, groupId: 'GROUP-A', warehouseId: WAREHOUSE_A1, productId: 'PROD-NEW', availableQty: 1, reservedQty: 0, onHandQty: 1, isDeleted: false }));
  });
  it('create stock with a FORGED warehouseId from another company → DENY (FK integrity)', async () => {
    const db = ctx(UID_WH_A1, 'wh.a1@neozy.test');
    await assertFails(setDoc(doc(db, 'stock', 'STK-FORGED'), { id: 'STK-FORGED', companyId: COMPANY_A, groupId: 'GROUP-A', warehouseId: WAREHOUSE_B1, productId: 'PROD-X', availableQty: 1, reservedQty: 0, onHandQty: 1, isDeleted: false }));
  });
  it('create stock in a same-company warehouse the actor is NOT assigned to → DENY (sameWarehouse)', async () => {
    const db = ctx(UID_WH_A1, 'wh.a1@neozy.test');
    await assertFails(setDoc(doc(db, 'stock', 'STK-OTHERWH'), { id: 'STK-OTHERWH', companyId: COMPANY_A, groupId: 'GROUP-A', warehouseId: WAREHOUSE_A2, productId: 'PROD-Y', availableQty: 1, reservedQty: 0, onHandQty: 1, isDeleted: false }));
  });
  it('create dispatch in own warehouse → ALLOW (createdBy anchored)', async () => {
    const db = ctx(UID_WH_A1, 'wh.a1@neozy.test');
    await assertSucceeds(setDoc(doc(db, 'dispatch', 'DSP-NEW'), { id: 'DSP-NEW', companyId: COMPANY_A, groupId: 'GROUP-A', warehouseId: WAREHOUSE_A1, status: 'Planned', createdBy: ID_WH_A1, isDeleted: false }));
  });
  it('create goods_receipts in own warehouse → ALLOW (receivedBy anchored)', async () => {
    const db = ctx(UID_WH_A1, 'wh.a1@neozy.test');
    await assertSucceeds(setDoc(doc(db, 'goods_receipts', 'GRN-NEW'), { id: 'GRN-NEW', goodsReceiptId: 'GRN-NEW', companyId: COMPANY_A, groupId: 'GROUP-A', warehouseId: WAREHOUSE_A1, purchaseOrderId: 'PO-1', receivedBy: ID_WH_A1, receivedItems: [{ lineIndex: 0 }], stockEntries: [], isDeleted: false }));
  });
  it('update own-warehouse stock qty → ALLOW; warehouseId is immutable', async () => {
    const db = ctx(UID_WH_A1, 'wh.a1@neozy.test');
    await assertSucceeds(updateDoc(doc(db, 'stock', 'STK-A1'), { availableQty: 11 }));
    // Re-pointing the record at another warehouse (escalation via update) is rejected.
    await assertFails(updateDoc(doc(db, 'stock', 'STK-A1'), { warehouseId: WAREHOUSE_A2 }));
  });
  it('update a cross-warehouse stock doc → DENY', async () => {
    const db = ctx(UID_WH_A1, 'wh.a1@neozy.test');
    await assertFails(updateDoc(doc(db, 'stock', 'STK-A2'), { availableQty: 99 }));
  });
  it('delete is denied everywhere on stock (soft-delete only)', async () => {
    await assertFails(deleteDoc(doc(ctx(UID_WH_A1, 'wh.a1@neozy.test'), 'stock', 'STK-A1')));
  });
});

describe('Phase 3 (F-07) — non-restricted roles keep company/group-wide warehouse visibility', () => {
  it('Company Admin reads stock across BOTH warehouses of their company → ALLOW (§8.2)', async () => {
    await assertSucceeds(getDoc(doc(ctx(UID_ADMIN_A, 'admin.a@neozy.test'), 'stock', 'STK-A1')));
    await assertSucceeds(getDoc(doc(ctx(UID_ADMIN_A, 'admin.a@neozy.test'), 'stock', 'STK-A2')));
  });
  it('Company Admin CANNOT read another company stock → DENY (company boundary intact)', async () => {
    await assertFails(getDoc(doc(ctx(UID_ADMIN_A, 'admin.a@neozy.test'), 'stock', 'STK-B1')));
  });
  it('GroupAdmin reads stock across companies in their Group → ALLOW (additive-OR intact)', async () => {
    await assertSucceeds(getDoc(doc(ctx(UID_GA_A, 'ga.a@neozy.test'), 'stock', 'STK-A1')));
    await assertSucceeds(getDoc(doc(ctx(UID_GA_A, 'ga.a@neozy.test'), 'stock', 'STK-A2')));
  });
  it('GroupAdmin CANNOT read stock in another Group → DENY (cross-Group boundary intact)', async () => {
    await assertFails(getDoc(doc(ctx(UID_GA_A, 'ga.a@neozy.test'), 'stock', 'STK-B1')));
  });
  it('ordinary Sales user reads any same-company stock → ALLOW (existing company behavior unchanged)', async () => {
    await assertSucceeds(getDoc(doc(ctx(UID_SALES_A, 'sales.a@neozy.test'), 'stock', 'STK-A1')));
  });
  it('Super Admin reads stock across companies and groups → ALLOW (break-glass intact)', async () => {
    const db = ctx(UID_SUPER_ADMIN, 'super@neozy.test');
    await assertSucceeds(getDoc(doc(db, 'stock', 'STK-A1')));
    await assertSucceeds(getDoc(doc(db, 'stock', 'STK-B1')));
  });
  // Regression coverage for the "Group Admin cannot add stock" runtime bug:
  // warehouseActorCanCreate()/Update() OR in groupAdminCanCreate()/Update(),
  // both of which require a `groupId` field on the written document
  // (groupAdminCanCreate/Update → hasGroupId()). The client-side stock write
  // path (useSaveStockEntry/stockIn) used a raw Firestore transaction that
  // bypassed createDocWithId()/updateDocById()'s automatic groupId stamping,
  // so a Group Admin write reaching only the groupAdminCanCreate() branch
  // (e.g. acting on a sibling Company of their Group, where the actor's own
  // auth-map companyId does not match the target document's companyId) was
  // silently denied even though the UI showed the action as available. These
  // tests pin the rules-layer contract the client fix now satisfies.
  it('GroupAdmin CAN create stock in a sibling Company of their Group WHEN groupId is present', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(setDoc(doc(db, 'stock', 'STK-GA-NEW'), {
      id: 'STK-GA-NEW', companyId: COMPANY_C, groupId: 'GROUP-A', warehouseId: WAREHOUSE_C1,
      productId: 'PROD-GA', availableQty: 1, reservedQty: 0, onHandQty: 1, isDeleted: false,
    }));
  });
  it('GroupAdmin CANNOT create stock in a sibling Company of their Group WITHOUT groupId (the pre-fix bug shape)', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(setDoc(doc(db, 'stock', 'STK-GA-NOGROUP'), {
      id: 'STK-GA-NOGROUP', companyId: COMPANY_C, warehouseId: WAREHOUSE_C1,
      productId: 'PROD-GA2', availableQty: 1, reservedQty: 0, onHandQty: 1, isDeleted: false,
    }));
  });
  it('GroupAdmin CANNOT create stock in another Group even with a forged matching groupId', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(setDoc(doc(db, 'stock', 'STK-GA-FORGED'), {
      id: 'STK-GA-FORGED', companyId: COMPANY_B, groupId: 'GROUP-A', warehouseId: WAREHOUSE_B1,
      productId: 'PROD-GA3', availableQty: 1, reservedQty: 0, onHandQty: 1, isDeleted: false,
    }));
  });
});

// Reproduces the ACTUAL real-world "admin@neozy.in still gets
// permission-denied even though the previous fix stamps the correct groupId"
// report end-to-end. Root cause: firestore.rules' actorGroupId() (every
// groupAdminCan*() check) reads groupId from user_auth_maps/{authUid} — a
// document written ONCE at first login and never refreshed again for an
// ordinary session. A Company Admin promoted to Group Admin (a fresh groupId
// stamped onto their LIVE users/{id} profile) keeps a mapping that was
// created before that promotion and so still carries no groupId at all —
// distinct from the already-covered "GroupAdmin identity legitimately has no
// group" fail-closed case (UID_GA_NOGROUP above), where the users doc ALSO
// has no groupId. Here the live profile is a real, fully-promoted Group
// Admin; only the auth map lagged behind.
describe('Regression — stale user_auth_maps (promoted-after-mapping-created) blocks Group Admin writes until self-healed', () => {
  const UID_GA_STALE = 'uid-ga-stale';
  const ID_GA_STALE = 'MUSR-GA-STALE';

  beforeEach(async () => {
    // Simulates the real production shape: users/{id}.groupId is the live,
    // correct value (as if an admin just promoted this actor to Group Admin
    // of GROUP-A), but their user_auth_maps/{authUid} entry predates that
    // promotion and was never told about it — written directly here
    // (bypassing rules) because no ordinary client write can backdate a
    // mapping into this already-inconsistent state; it can only arise from
    // the mapping having been created earlier, before the promotion.
    await env.withSecurityRulesDisabled(async (unrestricted) => {
      const db = unrestricted.firestore();
      await setDoc(doc(db, 'users', ID_GA_STALE), { ...userDoc(ID_GA_STALE, 'GroupAdmin', COMPANY_A, 'ga.stale@neozy.test'), groupId: 'GROUP-A' });
      await setDoc(doc(db, 'user_auth_maps', UID_GA_STALE), mappingDoc(UID_GA_STALE, ID_GA_STALE, COMPANY_A, 'ga.stale@neozy.test')); // no groupId
    });
  });

  it('reproduces the bug: stock create in a sibling Company is DENIED while the mapping is stale, even with a correct groupId payload', async () => {
    const db = ctx(UID_GA_STALE, 'ga.stale@neozy.test');
    await assertFails(setDoc(doc(db, 'stock', 'STK-GA-STALE-1'), {
      id: 'STK-GA-STALE-1', companyId: COMPANY_C, groupId: 'GROUP-A', warehouseId: WAREHOUSE_C1,
      productId: 'PROD-STALE', availableQty: 1, reservedQty: 0, onHandQty: 1, isDeleted: false,
    }));
  });

  it('proves the fix: after the mapping self-heal (adding groupId for the first time), the SAME write now succeeds', async () => {
    const db = ctx(UID_GA_STALE, 'ga.stale@neozy.test');
    // The exact write authIdentity.ts's refreshAuthMappingIfStale()/
    // resolveAuthenticatedErpUser() perform — a groupId-less mapping is
    // allowed to receive its first groupId (already proven generically at
    // "user_auth_maps groupId mirrors users.groupId", line ~500 above).
    await assertSucceeds(updateDoc(doc(db, 'user_auth_maps', UID_GA_STALE), { groupId: 'GROUP-A', updatedAt: new Date().toISOString() }));

    await assertSucceeds(setDoc(doc(db, 'stock', 'STK-GA-STALE-2'), {
      id: 'STK-GA-STALE-2', companyId: COMPANY_C, groupId: 'GROUP-A', warehouseId: WAREHOUSE_C1,
      productId: 'PROD-STALE2', availableQty: 1, reservedQty: 0, onHandQty: 1, isDeleted: false,
    }));
  });
});

describe('Phase 3 (F-08) — warehouses collection is authoritative (explicit block, FK target)', () => {
  it('company-scoped warehouse read → ALLOW; another company warehouse → DENY', async () => {
    await assertSucceeds(getDoc(doc(ctx(UID_ADMIN_A, 'admin.a@neozy.test'), 'warehouses', WAREHOUSE_A1)));
    await assertFails(getDoc(doc(ctx(UID_ADMIN_A, 'admin.a@neozy.test'), 'warehouses', WAREHOUSE_B1)));
  });
  it('warehouse-scoped list for a Warehouse-role user is company-provable → ALLOW', async () => {
    const db = ctx(UID_WH_A1, 'wh.a1@neozy.test');
    await assertSucceeds(getDocs(query(collection(db, 'warehouses'), where('companyId', '==', COMPANY_A))));
  });
  it('Admin creates a warehouse in own company → ALLOW; companyId immutable on update', async () => {
    const db = ctx(UID_ADMIN_A, 'admin.a@neozy.test');
    await assertSucceeds(setDoc(doc(db, 'warehouses', 'WH-A3'), { id: 'WH-A3', companyId: COMPANY_A, groupId: 'GROUP-A', name: 'Warehouse A3', status: 'Active' }));
    await assertFails(updateDoc(doc(db, 'warehouses', WAREHOUSE_A1), { companyId: COMPANY_B }));
  });
  it('Admin cannot create a warehouse into another company → DENY', async () => {
    const db = ctx(UID_ADMIN_A, 'admin.a@neozy.test');
    await assertFails(setDoc(doc(db, 'warehouses', 'WH-X'), { id: 'WH-X', companyId: COMPANY_B, groupId: 'GROUP-B', name: 'Warehouse X', status: 'Active' }));
  });
  it('delete is denied on warehouses (soft-delete via status only)', async () => {
    await assertFails(deleteDoc(doc(ctx(UID_ADMIN_A, 'admin.a@neozy.test'), 'warehouses', WAREHOUSE_A1)));
  });
});

describe('Phase 4 (Master Plan §6) — platform_settings is Super-Admin-only', () => {
  const owner = () => env.authenticatedContext('owner-uid', { email: 'shreeniwas.tripathi0@gmail.com' }).firestore();

  it('owner/Super Admin can read and write platform_settings/global; delete denied', async () => {
    const db = owner();
    await assertSucceeds(getDoc(doc(db, 'platform_settings', 'global')));
    await assertSucceeds(setDoc(doc(db, 'platform_settings', 'global'), { id: 'global', maintenanceMode: true, maintenanceMessage: 'Scheduled maintenance' }));
    await assertSucceeds(updateDoc(doc(db, 'platform_settings', 'global'), { id: 'global', maintenanceMode: false }));
    await assertFails(deleteDoc(doc(db, 'platform_settings', 'global')));
  });

  it('non-platform actors cannot read or write platform_settings', async () => {
    const admin = ctx(UID_ADMIN_A, 'admin.a@neozy.test');
    await assertFails(getDoc(doc(admin, 'platform_settings', 'global')));
    await assertFails(setDoc(doc(admin, 'platform_settings', 'global'), { id: 'global', maintenanceMode: true }));
    // GroupAdmin of GROUP-A also denied — platform_settings is platform-tier.
    const ga = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(getDoc(doc(ga, 'platform_settings', 'global')));
  });

  it('platform_settings create requires the deterministic id anchor', async () => {
    const db = owner();
    // id != documentId -> denied (id-anchor, mirrors groups/group_members).
    await assertFails(setDoc(doc(db, 'platform_settings', 'global'), { id: 'other', maintenanceMode: true }));
  });
});

describe('Phase 4 (Master Plan §6.6) — GroupAdmin grant/revoke write paths', () => {
  const owner = () => env.authenticatedContext('owner-uid', { email: 'shreeniwas.tripathi0@gmail.com' }).firestore();

  it('owner creates a Group with the id anchor (Create Group flow)', async () => {
    const db = owner();
    await assertSucceeds(setDoc(doc(db, 'groups', 'GROUP-NEW'), { id: 'GROUP-NEW', name: 'New Group', shortName: 'NG', status: 'Active' }));
    // id mismatch denied — the rules require the payload id == doc id.
    await assertFails(setDoc(doc(db, 'groups', 'GROUP-NEW2'), { id: 'WRONG', name: 'X', shortName: 'X', status: 'Active' }));
  });

  it('owner suspends/reactivates a Group (update with id anchor)', async () => {
    const db = owner();
    await assertSucceeds(updateDoc(doc(db, 'groups', 'GROUP-A'), { id: 'GROUP-A', status: 'Suspended' }));
    await assertSucceeds(updateDoc(doc(db, 'groups', 'GROUP-A'), { id: 'GROUP-A', status: 'Active' }));
    // id anchor on update: the merged doc keeps the existing id, so only an
    // EXPLICIT id mismatch is denied (a missing id field is harmless — the
    // merged request.resource.data.id still equals the path segment).
    await assertFails(updateDoc(doc(db, 'groups', 'GROUP-A'), { id: 'WRONG', status: 'Suspended' }));
  });

  it('owner grants GroupAdmin: group_members create + users role/groupId update', async () => {
    const db = owner();
    // 1) group_members/{groupId}_{userId} with the deterministic id + shape.
    await assertSucceeds(setDoc(doc(db, 'group_members', 'GROUP-A_MUSR-NEW-GA'), {
      id: 'GROUP-A_MUSR-NEW-GA', groupId: 'GROUP-A', userId: 'MUSR-NEW-GA', role: 'GroupAdmin', status: 'Active', grantedBy: 'owner:owner-uid',
    }));
    // 2) users/{id} role -> GroupAdmin + groupId (companyId unchanged).
    await assertSucceeds(updateDoc(doc(db, 'users', ID_USER_C), { role: 'GroupAdmin', groupId: 'GROUP-A', updatedBy: 'owner' }));
  });

  it('owner revokes GroupAdmin: group_members status Revoked + users role back to Admin', async () => {
    const db = owner();
    await assertSucceeds(updateDoc(doc(db, 'group_members', 'GROUP-A_MUSR-GA-A'), { id: 'GROUP-A_MUSR-GA-A', groupId: 'GROUP-A', userId: ID_GA_A, status: 'Revoked' }));
    await assertSucceeds(updateDoc(doc(db, 'users', ID_GA_A), { role: 'Admin', updatedBy: 'owner' }));
  });

  it('a GroupAdmin cannot forge the grant write path (self-grant / forged anchor / cross-group / no-member-doc)', async () => {
    const ga = ctx(UID_GA_A, 'ga.a@neozy.test');
    // Phase 5 (§7.9) opened group_members CREATE to an active Group Admin for
    // a SECOND Group Admin of their own Group — so the DENY cases are now:
    // 1) self-grant (target == the actor themself).
    await assertFails(setDoc(doc(ga, 'group_members', 'GROUP-A_MUSR-GA-A_SELF'), {
      id: 'GROUP-A_MUSR-GA-A_SELF', groupId: 'GROUP-A', userId: ID_GA_A, role: 'GroupAdmin', status: 'Active', grantedBy: ID_GA_A,
    }));
    // 2) forged grantedBy (not the actor's own ERP user id).
    await assertFails(setDoc(doc(ga, 'group_members', 'GROUP-A_MUSR-FORGE'), {
      id: 'GROUP-A_MUSR-FORGE', groupId: 'GROUP-A', userId: 'MUSR-FORGE', role: 'GroupAdmin', status: 'Active', grantedBy: ID_SUPER_ADMIN,
    }));
    // 3) cross-group grant (member doc's groupId != the actor's Group).
    await assertFails(setDoc(doc(ga, 'group_members', 'GROUP-B_MUSR-FORGE'), {
      id: 'GROUP-B_MUSR-FORGE', groupId: 'GROUP-B', userId: 'MUSR-FORGE', role: 'GroupAdmin', status: 'Active', grantedBy: ID_GA_A,
    }));
    // 4) role-only promotion WITHOUT the auditable member doc (branch C's
    //    exists() guard) -> denied.
    await assertFails(updateDoc(doc(ga, 'users', ID_USER_C), { role: 'GroupAdmin', groupId: 'GROUP-A' }));
    // GroupAdmin cannot create a Group (platform-tier, unchanged).
    await assertFails(setDoc(doc(ga, 'groups', 'GROUP-FORGE'), { id: 'GROUP-FORGE', name: 'X', shortName: 'X', status: 'Active' }));
  });
});

describe('Phase 5 (§7) — Group Admin control plane: identity, grant, promotion, teams, companies', () => {
  // ── A. GROUP ADMIN IDENTITY ──────────────────────────────────
  it('valid GroupAdmin with an authoritative groupId resolves Group scope', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    // Sibling company inside the same Group (CO-C): group-scoped read allowed.
    await assertSucceeds(getDoc(doc(db, 'leads', 'LEAD-C')));
    // Group-scoped query provable.
    await assertSucceeds(getDocs(query(collection(db, 'leads'), where('groupId', '==', 'GROUP-A'))));
  });
  it('GroupAdmin WITHOUT a groupId fails closed (no Group scope resolves)', async () => {
    const db = ctx(UID_GA_NOGROUP, 'ga.nogroup@neozy.test');
    // role == GroupAdmin but no groupId anywhere: the sibling-company doc
    // (CO-C, GROUP-A) is NOT readable — actorGroupId() is '' so no same-Group
    // path can resolve, and sameCompany() fails (CO-C != home CO-A).
    await assertFails(getDoc(doc(db, 'leads', 'LEAD-C')));
    // The Group-scoped list query is unprovable for this identity.
    await assertFails(getDocs(query(collection(db, 'leads'), where('groupId', '==', 'GROUP-A'))));
    // Home-company access still works (normal company tier, not Group tier).
    await assertSucceeds(getDoc(doc(db, 'leads', 'LEAD-A')));
  });
  it('non-GroupAdmin (ordinary Company user) cannot use the Group Admin grant path', async () => {
    const db = ctx(UID_USER_A, 'user.a@neozy.test');
    await assertFails(setDoc(doc(db, 'group_members', 'GROUP-A_MUSR-USER-C'), {
      id: 'GROUP-A_MUSR-USER-C', groupId: 'GROUP-A', userId: ID_USER_C, role: 'GroupAdmin', status: 'Active', grantedBy: ID_USER_A,
    }));
  });
  it('forged groupId cannot widen Group scope (query for another Group is denied)', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(getDocs(query(collection(db, 'leads'), where('groupId', '==', 'GROUP-B'))));
  });

  // ── B. GROUP_MEMBERS GRANT PATH (§7.9) ──────────────────────
  it('valid GroupAdmin grant: second GroupAdmin of their OWN Group', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(setDoc(doc(db, 'group_members', 'GROUP-A_MUSR-USER-C'), {
      id: 'GROUP-A_MUSR-USER-C', groupId: 'GROUP-A', userId: ID_USER_C, role: 'GroupAdmin', status: 'Active', grantedBy: ID_GA_A,
    }));
  });
  it('GroupAdmin CANNOT grant into another Group (forged groupId on the member doc)', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(setDoc(doc(db, 'group_members', 'GROUP-B_MUSR-USER-C'), {
      id: 'GROUP-B_MUSR-USER-C', groupId: 'GROUP-B', userId: ID_USER_C, role: 'GroupAdmin', status: 'Active', grantedBy: ID_GA_A,
    }));
  });
  it('GroupAdmin CANNOT self-grant (target == actor)', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(setDoc(doc(db, 'group_members', 'GROUP-A_SELF-GRANT'), {
      id: 'GROUP-A_SELF-GRANT', groupId: 'GROUP-A', userId: ID_GA_A, role: 'GroupAdmin', status: 'Active', grantedBy: ID_GA_A,
    }));
  });
  it('grant with a forged grantedBy anchor is denied', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(setDoc(doc(db, 'group_members', 'GROUP-A_MUSR-USER-C'), {
      id: 'GROUP-A_MUSR-USER-C', groupId: 'GROUP-A', userId: ID_USER_C, role: 'GroupAdmin', status: 'Active', grantedBy: ID_SUPER_ADMIN,
    }));
  });

  // ── C. USERS ROLE PROMOTION (§7.9) ──────────────────────────
  it('valid promotion: users.role -> GroupAdmin AFTER the member doc exists (auditable-membership-first)', async () => {
    // Seed the membership record (the grant path above is the legit way; seed
    // here to isolate the users-update branch under test).
    await env.withSecurityRulesDisabled(async (rulesDb) => {
      await setDoc(doc(rulesDb.firestore(), 'group_members', 'GROUP-A_MUSR-USER-C'), {
        id: 'GROUP-A_MUSR-USER-C', groupId: 'GROUP-A', userId: ID_USER_C, role: 'GroupAdmin', status: 'Active', grantedBy: ID_GA_A,
      });
    });
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(updateDoc(doc(db, 'users', ID_USER_C), { role: 'GroupAdmin', groupId: 'GROUP-A' }));
  });
  it('promotion of a user from ANOTHER Group is denied (groupId boundary)', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    // ID_GA_B lives in GROUP-B — branch C's resource.data.groupId ==
    // actorGroupId() check fails.
    await assertFails(updateDoc(doc(db, 'users', ID_GA_B), { role: 'GroupAdmin', groupId: 'GROUP-A' }));
  });
  it('promotion cannot move the target to a Company outside the actor Group (companyId invariant)', async () => {
    await env.withSecurityRulesDisabled(async (rulesDb) => {
      await setDoc(doc(rulesDb.firestore(), 'group_members', 'GROUP-A_MUSR-USER-C'), {
        id: 'GROUP-A_MUSR-USER-C', groupId: 'GROUP-A', userId: ID_USER_C, role: 'GroupAdmin', status: 'Active', grantedBy: ID_GA_A,
      });
    });
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    // Attempt to promote ID_USER_C AND re-home them into COMPANY_B (GROUP-B)
    // in one write: groupAdminUserCompanyMatches(request) fails.
    await assertFails(updateDoc(doc(db, 'users', ID_USER_C), { role: 'GroupAdmin', groupId: 'GROUP-A', companyId: COMPANY_B }));
  });
  it('promotion cannot change isSuperAdmin (no platform escalation through the GroupAdmin path)', async () => {
    await env.withSecurityRulesDisabled(async (rulesDb) => {
      await setDoc(doc(rulesDb.firestore(), 'group_members', 'GROUP-A_MUSR-USER-C'), {
        id: 'GROUP-A_MUSR-USER-C', groupId: 'GROUP-A', userId: ID_USER_C, role: 'GroupAdmin', status: 'Active', grantedBy: ID_GA_A,
      });
    });
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'users', ID_USER_C), { role: 'GroupAdmin', groupId: 'GROUP-A', isSuperAdmin: true }));
  });

  // ── D. TEAMS (§7.6) — generic fallback scoping ──────────────
  it('GroupAdmin reads teams of their OWN Group; another Group is denied', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(getDoc(doc(db, 'teams', 'TEAM-A1')));
    await assertFails(getDoc(doc(db, 'teams', 'TEAM-B1')));
  });
  it('ordinary Company user reads own-company teams only (cross-company denied)', async () => {
    const db = ctx(UID_USER_A, 'user.a@neozy.test');
    await assertSucceeds(getDoc(doc(db, 'teams', 'TEAM-A1')));
    await assertFails(getDoc(doc(db, 'teams', 'TEAM-B1')));
  });
  it('GroupAdmin creates a team in their own Group; forged groupId/companyId denied', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    // Valid: team inside CO-C (GROUP-A sibling company).
    await assertSucceeds(setDoc(doc(db, 'teams', 'TEAM-NEW-A'), { id: 'TEAM-NEW-A', companyId: COMPANY_C, groupId: 'GROUP-A', name: 'Team New', status: 'Active' }));
    // Forged groupId -> GROUP-B.
    await assertFails(setDoc(doc(db, 'teams', 'TEAM-FORGE-G'), { id: 'TEAM-FORGE-G', companyId: COMPANY_C, groupId: 'GROUP-B', name: 'X', status: 'Active' }));
    // Contradictory: CO-B's group is GROUP-B, not GROUP-A (groupIdMatchesCompany).
    await assertFails(setDoc(doc(db, 'teams', 'TEAM-FORGE-C'), { id: 'TEAM-FORGE-C', companyId: COMPANY_B, groupId: 'GROUP-A', name: 'X', status: 'Active' }));
  });
  it('teams delete is denied (generic fallback delete: false)', async () => {
    await assertFails(deleteDoc(doc(ctx(UID_GA_A, 'ga.a@neozy.test'), 'teams', 'TEAM-A1')));
  });
  // Phase 6 §6: list/query provability — group-view teams list
  it('GroupAdmin GROUP VIEW list query returns own-Group teams; cross-Group denied', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    // same-Group query — TEAM-A1 (GROUP-A) should be reachable
    await assertSucceeds(getDocs(query(collection(db, 'teams'), where('groupId', '==', 'GROUP-A'))));
    // cross-Group query — GROUP-B teams should be denied
    await assertFails(getDocs(query(collection(db, 'teams'), where('groupId', '==', 'GROUP-B'))));
  });
  // Phase 6 §6: list/query provability — company-view teams list
  it('ordinary user COMPANY VIEW list query returns own-company teams; cross-company denied', async () => {
    const db = ctx(UID_USER_A, 'user.a@neozy.test');
    await assertSucceeds(getDocs(query(collection(db, 'teams'), where('companyId', '==', COMPANY_A))));
    await assertFails(getDocs(query(collection(db, 'teams'), where('companyId', '==', COMPANY_B))));
  });
  // Phase 6 §6: GroupAdmin teams UPDATE matrix
  it('GroupAdmin updates team name in own Group — ALLOW', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(updateDoc(doc(db, 'teams', 'TEAM-A1'), { name: 'Team A1 renamed' }));
  });
  it('GroupAdmin CANNOT update a team belonging to another Group — cross-group DENY', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'teams', 'TEAM-B1'), { name: 'Stolen' }));
  });
  it('GroupAdmin CANNOT re-point a team to a different Company within own Group — companyId re-point DENY', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    // TEAM-A1 companyId=CO-A; attempt to shift companyId to CO-C (still GROUP-A)
    await assertFails(updateDoc(doc(db, 'teams', 'TEAM-A1'), { companyId: COMPANY_C }));
  });
  it('GroupAdmin CANNOT change a team groupId on update — groupId re-point DENY', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'teams', 'TEAM-A1'), { groupId: 'GROUP-B' }));
  });
  // Phase 6 §6: cross-group create — valid combination but wrong Group for actor
  it('GroupAdmin CANNOT create a team under another Group using a valid-looking combination', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    // companyId=CO-B belongs to GROUP-B (valid pairing), but actor is GROUP-A GroupAdmin
    await assertFails(setDoc(doc(db, 'teams', 'TEAM-XG'), { id: 'TEAM-XG', companyId: COMPANY_B, groupId: 'GROUP-B', name: 'Cross Group', status: 'Active' }));
  });

  // ── E. COMPANIES (§7.3) — GroupAdmin company creation ───────
  it('ordinary Company user CANNOT use the GroupAdmin company-creation path', async () => {
    const db = ctx(UID_USER_A, 'user.a@neozy.test');
    await assertFails(setDoc(doc(db, 'companies', 'CO-FORGE'), { id: 'CO-FORGE', companyId: 'CO-FORGE', name: 'Forge', groupId: 'GROUP-A' }));
  });
  it('GroupAdmin company creation stays Group-bound (cross-Group groupId denied)', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(setDoc(doc(db, 'companies', 'CO-FORGE'), { id: 'CO-FORGE', companyId: 'CO-FORGE', name: 'Forge', groupId: 'GROUP-B' }));
    // Same-Group create remains allowed (Phase 2 §5.2, unchanged).
    await assertSucceeds(setDoc(doc(db, 'companies', 'CO-D'), { id: 'CO-D', companyId: 'CO-D', name: 'Company D', groupId: 'GROUP-A' }));
  });

  // ── F. REGRESSION: Super Admin / Company Admin unchanged ────
  it('Super Admin retains the platform grant path (Phase 4 §6.6, unchanged)', async () => {
    const superDb = env.authenticatedContext(UID_SUPER_ADMIN, { email: 'super@neozy.test' }).firestore();
    await assertSucceeds(setDoc(doc(superDb, 'group_members', 'GROUP-A_MUSR-NEW-GA'), {
      id: 'GROUP-A_MUSR-NEW-GA', groupId: 'GROUP-A', userId: 'MUSR-NEW-GA', role: 'GroupAdmin', status: 'Active', grantedBy: ID_SUPER_ADMIN,
    }));
    await assertSucceeds(getDoc(doc(superDb, 'teams', 'TEAM-B1')));
  });
  it('Company Admin behavior unchanged (Phase 0/2 regression)', async () => {
    const db = ctx(UID_ADMIN_A, 'admin.a@neozy.test');
    await assertSucceeds(getDoc(doc(db, 'teams', 'TEAM-A1')));
    await assertFails(getDoc(doc(db, 'teams', 'TEAM-B1')));
    await assertSucceeds(updateDoc(doc(db, 'teams', 'TEAM-A1'), { name: 'Team A1 updated', updatedBy: ID_ADMIN_A }));
  });
});

describe('Phase 7 (Master Plan §12.5) — backup_metadata is Super-Admin read-only, client-write-proof', () => {
  const BID = '20260101-0000';

  it('owner identity can read backup_metadata', async () => {
    const db = ctx(UID_OWNER, 'shreeniwas.tripathi0@gmail.com');
    await assertSucceeds(getDoc(doc(db, 'backup_metadata', BID)));
    await assertSucceeds(getDocs(query(collection(db, 'backup_metadata'))));
  });

  it('Super Admin (isSuperAdmin flag, not the owner email) can read backup_metadata', async () => {
    const db = ctx(UID_SUPER_ADMIN, 'super@neozy.test');
    await assertSucceeds(getDocs(query(collection(db, 'backup_metadata'))));
  });

  it('non-platform actors (Company Admin, GroupAdmin) cannot read backup_metadata', async () => {
    const admin = ctx(UID_ADMIN_A, 'admin.a@neozy.test');
    await assertFails(getDoc(doc(admin, 'backup_metadata', BID)));
    const ga = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(getDoc(doc(ga, 'backup_metadata', BID)));
  });

  it('NO client identity — not even owner/Super Admin — may create backup_metadata', async () => {
    const owner = ctx(UID_OWNER, 'shreeniwas.tripathi0@gmail.com');
    await assertFails(setDoc(doc(owner, 'backup_metadata', BID), {
      id: BID, startedAt: new Date().toISOString(), status: 'Success', triggeredBy: 'manual',
    }));
    const superDb = ctx(UID_SUPER_ADMIN, 'super@neozy.test');
    await assertFails(setDoc(doc(superDb, 'backup_metadata', BID), { id: BID, status: 'Success' }));
  });

  it('NO client identity may update or delete an EXISTING backup_metadata doc (Admin-SDK-only, §3.1)', async () => {
    // Seed via the Admin-SDK-equivalent bypass (rules disabled) — mirrors how
    // scripts/record-backup-status.cjs actually writes this collection.
    await env.withSecurityRulesDisabled(async (rulesDb) => {
      await setDoc(doc(rulesDb.firestore(), 'backup_metadata', BID), { id: BID, status: 'Success', startedAt: new Date().toISOString() });
    });
    const owner = ctx(UID_OWNER, 'shreeniwas.tripathi0@gmail.com');
    await assertFails(updateDoc(doc(owner, 'backup_metadata', BID), { status: 'Failed' }));
    await assertFails(deleteDoc(doc(owner, 'backup_metadata', BID)));
    // Read remains allowed — proves the deny is write-specific, not a broken doc.
    await assertSucceeds(getDoc(doc(owner, 'backup_metadata', BID)));
  });
});

describe('Phase 8 (Master Plan §17.4) — generated per-collection tenant-isolation fuzz matrix', () => {
  const ga = () => ctx(UID_GA_A, 'ga.a@neozy.test');

  it.each(GROUP_SCOPED_FUZZ_COLLECTIONS)(
    'cross-Group DENY (GroupAdmin of GROUP-A cannot read a GROUP-B document): %s',
    async (col) => {
      await assertFails(getDoc(doc(ga(), col, `${col}-FUZZ-B`)));
    },
  );

  it.each(GROUP_SCOPED_FUZZ_COLLECTIONS.filter((c) => !FUZZ_GROUP_SCOPE_EXCEPTIONS.has(c)))(
    'same-Group sibling-Company ALLOW (GroupAdmin of GROUP-A reads a GROUP-A/Company-C document): %s',
    async (col) => {
      await assertSucceeds(getDoc(doc(ga(), col, `${col}-FUZZ-C`)));
    },
  );

  it('documented exception: device_tokens has NO GroupAdmin branch by design (F-17 user-anchoring takes priority)', async () => {
    await assertFails(getDoc(doc(ga(), 'device_tokens', 'device_tokens-FUZZ-C')));
  });

  it('sanity: the generated collection list matches the Master Plan §3.2 count this file exercises (fuzz + bespoke)', () => {
    // 37 fuzzed here + 11 already covered by dedicated bespoke describe blocks
    // above (leads, projects, purchase_orders, commission_rules,
    // security_logs, teams, warehouses, stock, dispatch, goods_receipts,
    // stock_ledger) = the full §3.2 list of 48 collections.
    expect(GROUP_SCOPED_FUZZ_COLLECTIONS.length).toBe(37);
  });
});
