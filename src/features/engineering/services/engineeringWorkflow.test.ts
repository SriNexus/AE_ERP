import { describe, expect, it } from 'vitest';
import { buildEngineeringDraftPayload, buildSurveySnapshot, validateDesignInput } from './engineeringWorkflow';
import type { ProjectRecord } from '../../projects/types';
import type { SurveyRecord } from '../../surveys/types';

const diagram = { id: 'DOC-1', name: 'sld.pdf', url: 'https://example.test/sld.pdf', storagePath: 'engineering/ENG-1/sld.pdf', contentType: 'application/pdf', size: 100, uploadedAt: '2026-07-10T00:00:00.000Z', category: 'single-line-diagram' as const };

describe('engineering workflow validation', () => {
  it('accepts a complete survey-linked design', () => {
    expect(() => validateDesignInput({ surveyId: 'SRV-1', designerId: 'USR-1', panelCount: 20, panelWattage: 550, inverterSpec: '10 kW three-phase inverter', systemCapacityKw: 11, documents: [diagram] })).not.toThrow();
  });

  it('rejects invalid sizing data', () => {
    expect(() => validateDesignInput({ surveyId: 'SRV-1', designerId: 'USR-1', panelCount: 0, panelWattage: 550, inverterSpec: '10 kW inverter', systemCapacityKw: 11, documents: [diagram] })).toThrow('Panel count');
  });

  it('requires the single-line diagram', () => {
    expect(() => validateDesignInput({ surveyId: 'SRV-1', designerId: 'USR-1', panelCount: 20, panelWattage: 550, inverterSpec: '10 kW inverter', systemCapacityKw: 11, documents: [] })).toThrow('Single-line diagram');
  });

  it('transfers approved survey measurements and photos into a draft', () => {
    const survey = {
      id: 'SRV-1', surveyId: 'SRV-1', companyId: 'COMP-1', projectId: 'PRJ-1', surveyorId: 'SURVEYOR-1', assignedSurveyor: 'SURVEYOR-1', scheduledDate: '2026-07-09T00:00:00.000Z', completedDate: '2026-07-10T00:00:00.000Z', roofType: 'RCC', roofAreaSqm: 125, shadingNotes: 'Minor east shading', structuralNotes: 'Slab suitable', photos: [{ id: 'PHOTO-1', name: 'roof.jpg', url: 'https://example.test/roof.jpg', storagePath: 'surveys/SRV-1/roof.jpg', contentType: 'image/jpeg', size: 1000, capturedAt: '2026-07-10T00:00:00.000Z' }], status: 'Completed', approvalStatus: 'Pending',
    } satisfies SurveyRecord;
    const project = { id: 'PRJ-1', projectId: 'PRJ-1', companyId: 'COMP-1', customerId: 'CUS-1', capacityKw: 10, siteAddress: {}, currentStage: 'Survey', stageHistory: [], linkedQuotationIds: [], linkedOrderIds: [], linkedDispatchIds: [], assignedSurveyor: 'SURVEYOR-1', salesOwner: 'SALES-1' } satisfies ProjectRecord;
    const snapshot = buildSurveySnapshot(survey);
    const draft = buildEngineeringDraftPayload(survey, project, 'ENGINEER-1', 'ENG-1');

    expect(snapshot).toMatchObject({ roofType: 'RCC', roofAreaSqm: 125, shadingNotes: 'Minor east shading', structuralNotes: 'Slab suitable' });
    expect(snapshot.photos).toHaveLength(1);
    expect(draft).toMatchObject({ designId: 'ENG-1', projectId: 'PRJ-1', surveyId: 'SRV-1', designerId: 'ENGINEER-1', status: 'Draft', panelCount: 0, panelWattage: 0, systemCapacityKw: 0 });
    expect(draft.surveySnapshot.photos[0].id).toBe('PHOTO-1');
  });
});
