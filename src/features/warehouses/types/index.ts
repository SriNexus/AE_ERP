import type { BaseRecord } from '../../../types';

export interface Warehouse extends BaseRecord {
  name:          string;
  code:          string;
  address?:      string;
  city?:         string;
  state?:        string;
  pincode?:      string;
  managerName?:  string;
  managerPhone?: string;
  capacity?:     string;
  status:        string;
  notes?:        string;
}

export const WAREHOUSE_FORM_DEFAULT = {
  name: '', code: '', address: '', city: '', state: '',
  pincode: '', managerName: '', managerPhone: '', capacity: '',
  status: 'Active', notes: '',
};

export type WarehouseForm = typeof WAREHOUSE_FORM_DEFAULT;

export const WAREHOUSE_STATUS_OPTIONS = [
  { label: 'Active',             value: 'Active' },
  { label: 'Inactive',           value: 'Inactive' },
  { label: 'Under Maintenance',  value: 'Under Maintenance' },
];
