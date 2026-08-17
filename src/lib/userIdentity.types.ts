export type UserIdentityRole =
  | 'Lead'
  | 'Customer'
  | 'Employee'
  | 'User'
  | 'Driver'
  | 'Vendor'
  | 'InstallationPartner'
  | 'FieldAgent';

export type ProjectionRoleRegistration = Readonly<{
  role: UserIdentityRole;
  collection: string;
  ownerField: 'userId';
}>;

export type ProjectionSafePayload = Readonly<Record<string, unknown>>;

export type UserIdentityRecord = Readonly<{
  id: string;
  userId: string;
  companyId: string;
  identityPhone: string;
  roles: readonly UserIdentityRole[];
  linkedModules: readonly string[];
  name?: string;
  phone?: string;
  email?: string;
  profile?: Readonly<Record<string, unknown>>;
  filters?: Readonly<Record<string, unknown>>;
  status?: string;
  createdBy?: string;
  updatedBy?: string;
  isDeleted?: boolean;
}>;

export type UserIdentityUniquenessKey = Readonly<{
  companyId: string;
  identityPhone: string;
}>;

export type UserIdentityConsistencyIssue = Readonly<{
  code:
    | 'duplicate_identity_phone'
    | 'missing_identity_phone'
    | 'missing_role'
    | 'missing_linked_module';
  userId?: string;
  companyId?: string;
  identityPhone?: string;
  role?: UserIdentityRole;
  linkedModule?: string;
}>;
