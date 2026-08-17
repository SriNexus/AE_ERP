import type { BaseRecord } from '../../../types';

export type SurveyStatus = 'Scheduled' | 'InProgress' | 'Completed' | 'Rejected';
export type SurveyApprovalStatus = 'NotSubmitted' | 'Pending' | 'Approved' | 'Rejected';

export interface SurveyPhoto {
  id: string;
  name: string;
  url: string;
  storagePath: string;
  contentType: string;
  size: number;
  capturedAt: string;
}

export interface SurveyLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
  capturedAt: string;
  /** Best-effort, free reverse-geocoded human-readable label for this exact
   * point (see features/surveys/services/reverseGeocode.ts) — an
   * enhancement resolved shortly after capture, never required. Absent
   * when the lookup fails/times out/is unavailable; the coordinates above
   * remain the source of truth regardless. */
  address?: string;
}

export interface SurveyRecord extends BaseRecord {
  surveyId: string;
  projectId: string;
  surveyorId: string;
  assignedSurveyor: string;
  scheduledDate: string;
  completedDate?: string;
  /** The user who actually filled in and submitted the report (distinct
   * from approvedBy, the Engineer who later approves/rejects it) — set
   * once at submission time and never overwritten by a later approve/
   * reject, so "completed by" attribution stays correct after review. */
  completedBy?: string;
  roofType?: string;
  roofAreaSqm?: number;
  shadingNotes?: string;
  structuralNotes?: string;
  notes?: string;
  photos: SurveyPhoto[];
  location?: SurveyLocation;
  status: SurveyStatus;
  approvalStatus: SurveyApprovalStatus;
  approvedAt?: string;
  approvedBy?: string;
  approvalNote?: string;
  engineeringDesignId?: string;
  engineeringHandoffAt?: string;
  rejectionReason?: string;
}

export interface ScheduleSurveyInput {
  projectId: string;
  surveyorId: string;
  scheduledDate: string;
  notes?: string;
}

export interface SurveyReportInput {
  roofType: string;
  roofAreaSqm: number;
  shadingNotes: string;
  structuralNotes: string;
  notes?: string;
  photos: SurveyPhoto[];
  location?: SurveyLocation;
}
