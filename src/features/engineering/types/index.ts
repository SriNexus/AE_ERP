import type { BaseRecord } from '../../../types';
import type { SurveyPhoto } from '../../surveys/types';

export type EngineeringDesignStatus = 'Draft' | 'InReview' | 'Approved' | 'Revised' | 'Cancelled';

export interface EngineeringDocument {
  id: string;
  name: string;
  url: string;
  storagePath: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  category: 'single-line-diagram' | 'structural-drawing';
}

export interface EngineeringRevision {
  revisionNumber: number;
  panelCount: number;
  panelWattage: number;
  inverterSpec: string;
  systemCapacityKw: number;
  singleLineDiagramUrl: string;
  structuralDrawingUrl: string;
  retainedAt: string;
  retainedBy: string;
  reason: string;
}

export interface EngineeringSurveySnapshot {
  roofType: string;
  roofAreaSqm: number;
  shadingNotes: string;
  structuralNotes: string;
  photos: SurveyPhoto[];
  capturedAt: string;
}

export interface EngineeringDesignRecord extends BaseRecord {
  designId: string;
  projectId: string;
  surveyId: string;
  panelCount: number;
  panelWattage: number;
  inverterSpec: string;
  systemCapacityKw: number;
  singleLineDiagramUrl: string;
  structuralDrawingUrl: string;
  documents: EngineeringDocument[];
  designerId: string;
  assignedSurveyor?: string;
  assignedInstaller?: string;
  salesOwner?: string;
  status: EngineeringDesignStatus;
  revisionNumber: number;
  revisionHistory: EngineeringRevision[];
  surveySnapshot?: EngineeringSurveySnapshot;
  handoffCreatedAt?: string;
  handoffCreatedBy?: string;
  submittedAt?: string;
  approvedAt?: string;
  approvedBy?: string;
  approvalNote?: string;
  revisionReason?: string;
}

export interface DesignInput {
  surveyId: string;
  designerId: string;
  panelCount: number;
  panelWattage: number;
  inverterSpec: string;
  systemCapacityKw: number;
  documents: EngineeringDocument[];
}

export type DesignUpdateInput = Omit<DesignInput, 'surveyId'>;
