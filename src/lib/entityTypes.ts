export type EntityRole =
  | 'Lead'
  | 'Customer'
  | 'Employee'
  | 'User'
  | 'Vendor'
  | 'Driver'
  | 'Installer'
  | 'Transporter'
  | 'Contact';

export type EntityContact = {
  value: string;
  label?: string;
  isPrimary?: boolean;
};

export type EntityAddress = {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  label?: string;
  isPrimary?: boolean;
};

export type EntitySearch = {
  normalizedName: string;
  phoneTokens: string[];
  emailTokens: string[];
};

export type EntityLegacyRefs = {
  leadId?: string;
  customerId?: string;
  employeeId?: string;
  userId?: string;
  vendorId?: string;
  driverId?: string;
  installerId?: string;
};

export type EntityRecord = {
  id: string;
  companyId: string;

  primaryRole: EntityRole;
  roles: EntityRole[];

  displayName: string;
  legalName: string;

  phones: EntityContact[];
  emails: EntityContact[];
  addresses: EntityAddress[];

  leadData?: Record<string, unknown>;
  customerData?: Record<string, unknown>;
  employeeData?: Record<string, unknown>;
  vendorData?: Record<string, unknown>;
  driverData?: Record<string, unknown>;
  installerData?: Record<string, unknown>;
  userData?: Record<string, unknown>;

  tags: string[];

  search: EntitySearch;

  legacyRefs: EntityLegacyRefs;

  createdAt: unknown;
  updatedAt: unknown;

  createdBy: string;
  updatedBy: string;

  isDeleted: boolean;
};

export type EntityCreateInput = {
  companyId: string;

  primaryRole: EntityRole;
  roles: EntityRole[];

  displayName: string;
  legalName?: string;

  phones?: EntityContact[];
  emails?: EntityContact[];
  addresses?: EntityAddress[];

  leadData?: Record<string, unknown>;
  customerData?: Record<string, unknown>;
  employeeData?: Record<string, unknown>;
  vendorData?: Record<string, unknown>;
  driverData?: Record<string, unknown>;
  installerData?: Record<string, unknown>;
  userData?: Record<string, unknown>;

  tags?: string[];

  legacyRefs?: EntityLegacyRefs;

  createdBy: string;
};

export type EntityUpdateInput = Partial<
  Omit<EntityCreateInput, 'companyId' | 'createdBy' | 'search'>
> & {
  updatedBy: string;
};

export type EntityResolutionResult = {
  entity: EntityRecord | null;
  created: boolean;
  matched: boolean;
  matchReason?: 'phone' | 'email';
  diagnostics: string[];
};
