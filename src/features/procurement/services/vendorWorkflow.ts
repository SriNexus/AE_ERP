import { COLLECTIONS } from '../../../lib/firebase';
import { createDocWithId, deleteDocById, genId, getAll, getOne, updateDocById } from '../../../lib/firestore';
import { canDo } from '../../../lib/permissions';
import { useAppStore } from '../../../store/useAppStore';
import { logActivity } from '../../../lib/workflow';
import type { VendorFormValues, VendorRecord } from '../types';

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeVendorInput(input: VendorFormValues) {
  const name = input.name.trim();
  const gstin = input.gstin.trim().toUpperCase();
  const email = input.email.trim().toLowerCase();
  if (!name) throw new Error('Vendor name is required');
  if (gstin && !GSTIN_PATTERN.test(gstin)) throw new Error('Enter a valid 15-character GSTIN');
  if (email && !EMAIL_PATTERN.test(email)) throw new Error('Enter a valid email address');
  const categoryTags = Array.from(new Set(input.categoryTags.split(',').map((tag) => tag.trim()).filter(Boolean)));
  return {
    name, gstin,
    contactInfo: {
      contactPerson: input.contactPerson.trim(), phone: input.phone.trim(), email, address: input.address.trim(),
    },
    paymentTerms: input.paymentTerms.trim(), categoryTags,
  };
}

async function ensureUniqueGstin(gstin: string, excludeId?: string) {
  if (!gstin) return;
  const vendors = await getAll<VendorRecord>(COLLECTIONS.VENDORS);
  if (vendors.some((vendor) => vendor.id !== excludeId && vendor.gstin === gstin)) throw new Error('A vendor with this GSTIN already exists');
}

export async function createVendor(input: VendorFormValues) {
  if (!canDo('create', 'vendors')) throw new Error('You do not have permission to create vendors');
  const data = normalizeVendorInput(input);
  await ensureUniqueGstin(data.gstin);
  const state = useAppStore.getState();
  const id = genId.generic('VEN');
  const vendor = { ...data, id, vendorId: id, createdBy: state.user?.id || '' };
  await createDocWithId(COLLECTIONS.VENDORS, id, vendor);
  await logActivity('Vendors', 'Created', id, { entityName: data.name, actionLabel: 'Created vendor master record' });
  return vendor as VendorRecord;
}

export async function updateVendor(id: string, input: VendorFormValues) {
  if (!canDo('edit', 'vendors')) throw new Error('You do not have permission to edit vendors');
  const existing = await getOne<VendorRecord>(COLLECTIONS.VENDORS, id);
  if (!existing) throw new Error('Vendor not found');
  const data = normalizeVendorInput(input);
  await ensureUniqueGstin(data.gstin, id);
  await updateDocById(COLLECTIONS.VENDORS, id, data);
  await logActivity('Vendors', 'Updated', id, { entityName: data.name, actionLabel: 'Updated vendor master record' });
  return { ...existing, ...data };
}

export async function deleteVendor(id: string) {
  if (!canDo('delete', 'vendors')) throw new Error('You do not have permission to delete vendors');
  const existing = await getOne<VendorRecord>(COLLECTIONS.VENDORS, id);
  if (!existing) throw new Error('Vendor not found');
  await deleteDocById(COLLECTIONS.VENDORS, id);
  await logActivity('Vendors', 'Deleted', id, { entityName: existing.name, actionLabel: 'Deleted vendor master record' });
}
