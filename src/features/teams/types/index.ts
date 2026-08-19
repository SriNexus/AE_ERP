/**
 * Team — org-directory construct (Master Plan §3.1 `teams/{teamId}`).
 *
 * Additive organizational metadata in V1 — explicitly NOT a security
 * boundary (§2.3): the existing managerId-derived teamMemberIds visibility
 * mechanism remains the data-visibility authority. Company/Group scoping and
 * writes behave like every other business collection (groupId is
 * write-helper stamped from companyId, never client-supplied).
 */

export type Team = {
  id: string;
  companyId: string;
  groupId?: string;
  warehouseId?: string;
  name: string;
  leadUserId?: string;
  memberUserIds?: string[];
  department?: string;
  status: 'Active' | 'Archived';
  createdAt?: unknown;
  createdBy?: string;
  updatedAt?: unknown;
  updatedBy?: string;
  isDeleted?: boolean;
};

export const TEAM_STATUS_OPTIONS = [
  { label: 'Active', value: 'Active' },
  { label: 'Archived', value: 'Archived' },
];

export const TEAM_FORM_DEFAULT = {
  name: '',
  companyId: '',
  warehouseId: '',
  leadUserId: '',
  memberUserIds: [] as string[],
  department: '',
  status: 'Active' as const,
};
