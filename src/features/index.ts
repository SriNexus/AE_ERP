// features/index.ts — Feature module barrel
// Use individual feature imports for tree-shaking

// Auth
export * from './auth/components/UserMenu';

// Categories
export * from './categories/hooks/useCategories';
export * from './categories/types';

// Customers
export * from './customers/hooks/useCustomers';

// Employees
export * from './employees/hooks/useEmployees';

// HR
export * from './hr/hooks/useHR';

// Inventory
export * from './inventory/hooks/useInventory';

// Leads
export * from './leads/hooks/useLeads';
export * from './leads/utils/leadsCsv';

// Sales
export * from './sales/hooks/useSales';

// Warehouses
export * from './warehouses/hooks/useWarehouses';
export * from './warehouses/types';
