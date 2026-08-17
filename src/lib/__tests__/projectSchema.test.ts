import { describe, expect, it } from 'vitest';
import { COLLECTIONS } from '../firebase';
import { getEntityRegistryEntry } from '../entityRegistry';
import { genId } from '../firestore';
import { queryKeys } from '../queryKeys';
import { ALL_MODULES } from '../permissions';
import { getSystemRoleSeedDocuments } from '../roleBootstrap';

describe('project schema foundation', () => {
  it('registers the projects collection and entity metadata', () => {
    expect(COLLECTIONS.PROJECTS).toBe('projects');

    const entry = getEntityRegistryEntry('projects');
    expect(entry).toMatchObject({
      collectionName: 'projects',
      entityType: 'project',
      module: 'projects',
      companyScoped: true,
    });
  });

  it('exposes a company-scoped projects query key', () => {
    expect(queryKeys.forCompany('company-123').projectsRoot).toEqual(['projects', 'company-123']);
  });

  it('generates project ids in the documented format', () => {
    expect(genId.project()).toMatch(/^PRJ-\d{8}-[A-Z0-9]{4}$/);
  });

  it('includes projects in the permission model and role seeds', () => {
    expect(ALL_MODULES).toContain('projects');

    const admin = getSystemRoleSeedDocuments().find((role) => role.name === 'Admin');
    expect(admin?.permissions.projects?.view).toBe(true);
    expect(admin?.permissions.projects?.create).toBe(true);
    expect(admin?.permissions.projects?.edit).toBe(true);
    expect(admin?.permissions.projects?.delete).toBe(true);
  });
});
