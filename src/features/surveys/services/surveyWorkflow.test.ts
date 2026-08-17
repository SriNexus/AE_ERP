import { describe, expect, it } from 'vitest';
import { validateScheduleInput, validateSurveyReport } from './surveyWorkflow';

describe('survey workflow validation', () => {
  it('accepts a complete schedule', () => {
    expect(() => validateScheduleInput({ projectId: 'PRJ-1', surveyorId: 'USR-1', scheduledDate: '2026-07-10T10:00:00.000Z' })).not.toThrow();
  });

  it('requires assignment and a valid date', () => {
    expect(() => validateScheduleInput({ projectId: 'PRJ-1', surveyorId: '', scheduledDate: 'invalid' })).toThrow('Surveyor assignment');
  });

  it('requires measurements and a site photo', () => {
    expect(() => validateSurveyReport({ roofType: 'RCC', roofAreaSqm: 0, shadingNotes: '', structuralNotes: '', photos: [] })).toThrow('Roof area');
    expect(() => validateSurveyReport({ roofType: 'RCC', roofAreaSqm: 120, shadingNotes: '', structuralNotes: '', photos: [] })).toThrow('site photo');
  });
});
