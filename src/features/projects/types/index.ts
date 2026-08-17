import type { BaseRecord, ProjectSiteAddress, ProjectStage } from '../../../types';

export type { ProjectSiteAddress, ProjectStage };

/** The Project's own type — a real field on the Project record itself, not
 * derived from the linked Customer's B2C propertyType/projectType (which
 * has a different vocabulary — Residential/Commercial/Industrial/
 * Agricultural — and only ever exists for B2C customers). Used consistently
 * across the create/edit form, the Workspace's Left Panel and Header, the
 * standalone Projects.tsx list/detail views, and the mobile equivalents. */
export const PROJECT_TYPES = ['Residential', 'Commercial', 'Industrial'] as const;
export type ProjectType = typeof PROJECT_TYPES[number];

export interface ProjectFormValues {
  customerId: string;
  leadId: string;
  capacityKw: string;
  projectType: string;
  salesOwner: string;
  assignedSurveyor: string;
  assignedInstaller: string;
  siteAddress: ProjectSiteAddress;
  notes: string;
}

export const PROJECT_FORM_DEFAULT: ProjectFormValues = {
  customerId: '',
  leadId: '',
  capacityKw: '',
  projectType: '',
  salesOwner: '',
  assignedSurveyor: '',
  assignedInstaller: '',
  notes: '',
  siteAddress: {
    line1: '',
    line2: '',
    landmark: '',
    city: '',
    district: '',
    state: '',
    pincode: '',
    country: 'India',
  },
};

export interface ProjectRecord extends BaseRecord {
  projectId: string;
  customerId: string;
  leadId?: string;
  /** Phase 0 (Channel Partner): partner doc id (e.g. `CP-…`) that owns this
   * project — part of the canonical ownership chain
   * Partner → Lead → Customer → Project → Registration (§9.1). */
  partnerId?: string;
  /** Denormalized partner display name (Phase 0 ownership contract §9.1). */
  partnerName?: string;
  capacityKw: number;
  projectType?: string;
  siteAddress: ProjectSiteAddress;
  currentStage: ProjectStage;
  stageHistory: Array<{
    stage: ProjectStage;
    changedAt: string;
    changedBy?: string;
    note?: string;
  }>;
  assignedSurveyor?: string;
  assignedInstaller?: string;
  salesOwner?: string;
  notes?: string;
  documents?: any[];
  linkedQuotationIds: string[];
  linkedOrderIds: string[];
  linkedDispatchIds: string[];
  archivedAt?: string;
  archiveReason?: string;
}

