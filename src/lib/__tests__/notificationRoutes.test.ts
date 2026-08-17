import { describe, expect, it } from 'vitest';
import { getNotificationRoute } from '../notificationRoutes';

describe('getNotificationRoute', () => {
  it('routes withdrawal notifications to Settlements — previously fell through to the generic /notifications fallback', () => {
    expect(getNotificationRoute('withdrawal', 'WD-1')).toBe('/settlements?open=WD-1');
    expect(getNotificationRoute('withdrawal', '')).toBe('/settlements');
  });

  it('routes case notifications exactly once (the block was previously duplicated verbatim)', () => {
    expect(getNotificationRoute('case', 'CASE-1')).toBe('/cases/CASE-1');
  });

  it('routes survey notifications to the Project Workspace stage card (popup retired)', () => {
    expect(getNotificationRoute('survey', 'SRV-1', 'PRJ-1')).toBe('/projects/PRJ-1');
    // Legacy record without projectId degrades to the list page — never a
    // stale ?open= popup link.
    expect(getNotificationRoute('survey', 'SRV-1')).toBe('/surveys');
    expect(getNotificationRoute('survey', '')).toBe('/surveys');
  });

  it('routes engineering design notifications to the Project Workspace stage card (popup retired)', () => {
    expect(getNotificationRoute('engineering_design', 'ENG-1', 'PRJ-1')).toBe('/projects/PRJ-1');
    expect(getNotificationRoute('engineeringdesign', 'ENG-1', 'PRJ-1')).toBe('/projects/PRJ-1');
    expect(getNotificationRoute('engineering', 'ENG-1', 'PRJ-1')).toBe('/projects/PRJ-1');
    // Legacy record without projectId degrades to the list page — never a
    // stale ?open= popup link.
    expect(getNotificationRoute('engineering_design', 'ENG-1')).toBe('/engineering-designs');
    expect(getNotificationRoute('engineering', '')).toBe('/engineering-designs');
  });

  it('routes scheme_registration notifications to the Project Workspace stage card (VL-11)', () => {
    expect(getNotificationRoute('scheme_registration', 'SREG-001', 'PRJ-1')).toBe('/projects/PRJ-1');
    expect(getNotificationRoute('schemeregistration', 'SREG-001', 'PRJ-1')).toBe('/projects/PRJ-1');
    // Legacy records without a projectId fall back to the Projects list.
    expect(getNotificationRoute('scheme_registration', 'SREG-001')).toBe('/projects');
  });

  it('keeps the loan entityType \'registration\' on its existing (non-scheme) routing (VL-11 loan separation)', () => {
    expect(getNotificationRoute('registration', 'RG-001', 'PRJ-1')).toBe('/notifications');
  });

  it('falls back to /notifications for a genuinely unknown entity type', () => {
    expect(getNotificationRoute('not-a-real-entity-type', 'X-1')).toBe('/notifications');
  });
});
