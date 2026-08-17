/**
 * projectsMasterForm.test.ts — Blueprint Phase 4 (B2C Customer -> Project
 * Foundation) wiring checks for the "Single Customer + Project master
 * creation flow" / "Automatic Customer creation when creating a Project
 * directly" requirement.
 *
 * Source-text analysis, matching this repo's established convention for
 * wiring facts that can't be logic-tested without @testing-library/react
 * (see customerWorkspacePhase2.test.ts). The actual business logic —
 * mandatory projectType, the B2B/Project guard, the reclassification guard —
 * is unit-tested directly in projectWorkflow.test.ts,
 * projectWorkflowCreateGuard.test.ts, and customerReclassificationGuard.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const projectsPage = read('../Projects.tsx');
const mobileProjectList = read('../../components/mobile/projects/MobileProjectList.tsx');
const sharedProjectForm = read('../../features/projects/components/ProjectForm.tsx');

describe('Projects.tsx (desktop) — master Customer + Project creation flow', () => {
  it('offers an Existing/New Customer toggle, not shown while editing', () => {
    expect(projectsPage).toContain("useState<'existing' | 'new'>('existing')");
    expect(projectsPage).toMatch(/!editId &&[\s\S]{0,80}customerMode/);
  });

  it('a new customer is always created as B2C — Projects are a B2C-exclusive workflow', () => {
    expect(projectsPage).toMatch(/type:\s*'B2C'/);
  });

  it('creates the customer via the shared createCustomerProjection() — no parallel customer-creation path', () => {
    expect(projectsPage).toContain("import { createCustomerProjection } from '../features/customers/hooks/useCustomers'");
    expect(projectsPage).toContain('await createCustomerProjection(customerId,');
  });

  it('passes the new customer id straight into createProject() via the existing useSaveProject mutation', () => {
    expect(projectsPage).toMatch(/createProject\.mutate\(\{\s*\.\.\.form,\s*customerId,/);
  });

  it('resets customer-mode state on open and close so no previous session leaks into the next', () => {
    expect(projectsPage).toMatch(/function openCreate\(\)[\s\S]{0,200}setCustomerMode\('existing'\)/);
    expect(projectsPage).toMatch(/function closeForm\(\)[\s\S]{0,200}setCustomerMode\('existing'\)/);
  });
});

describe('MobileProjectList.tsx — parity with the desktop master creation flow', () => {
  it('mirrors the same Existing/New Customer toggle and forced B2C type', () => {
    expect(mobileProjectList).toContain("useState<'existing' | 'new'>('existing')");
    expect(mobileProjectList).toMatch(/type:\s*'B2C'/);
    expect(mobileProjectList).toContain("import { createCustomerProjection } from '../../../features/customers/hooks/useCustomers'");
  });

  it('gates the toggle out of the edit path the same way desktop does', () => {
    expect(mobileProjectList).toMatch(/!editId &&[\s\S]{0,80}customerModeToggle/);
  });
});

describe('ProjectForm.tsx — Project Type is mandatory (shared across desktop, mobile, Customer Workspace)', () => {
  it('renders Project Type as a required Select', () => {
    expect(sharedProjectForm).toMatch(/label="Project Type"[\s\S]{0,40}required/);
  });

  it('supports lockedCustomerLabel so the master-form new-customer draft can occupy the customer slot before it has a real id', () => {
    expect(sharedProjectForm).toContain('lockedCustomerLabel');
  });
});
