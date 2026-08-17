/**
 * projectWorkspaceLoanApplicationCard.test.ts — Loan Application card
 * restoration mission (Project Workspace only).
 *
 * Source-text analysis (this codebase's established convention — no
 * @testing-library/react). The Project Workspace's 13 stage cards come from
 * resolveProjectWorkspaceStages() (src/hooks/useProjectStage.ts), rendered
 * through the shared ProjectStageCard shell by ProjectWorkOnThisProject.tsx.
 * Loan Application (bank financing) is a SEPARATE entity — it is NOT a member
 * of the ProjectStage union and NOT in the canonical PROJECT_STAGE_ORDER, so
 * it can never be Project.currentStage and never appears in stageHistory. The
 * Loan Application card is therefore inserted LOCALLY in
 * ProjectWorkOnThisProject (between Quotation and Order, the B2C spine
 * position), rendered through the SAME ProjectStageCard shell, with its
 * status derived from the real loan application record (the `registrations`
 * Firestore collection — retained for backward compatibility). The shared
 * engine is untouched — this card must never leak into the Customer Workspace
 * timeline or any other resolveProjectWorkspaceStages() consumer.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const workOnThisProject = read('../../features/projects/components/workspace/ProjectWorkOnThisProject.tsx');
const stageCard = read('../../features/projects/components/workspace/ProjectStageCard.tsx');
const stageRegistry = read('../../features/projects/components/workspace/stages/index.ts');
const useProjectStageSrc = read('../../hooks/useProjectStage.ts');
const projectLifecycle = read('../../lib/projectLifecycle.ts');
const sharedTypes = read('../../types/index.ts');
const loanApplicationWorkflow = read('../../features/loan-applications/services/loanApplicationWorkflow.ts');

describe('Loan Application card — inserted locally after Quotation, rendered through the SAME ProjectStageCard shell', () => {
  it('inserts the Loan Application display stage immediately AFTER Quotation (the B2C spine position) via a local splice on the engine stages — never by editing the shared LIFECYCLE', () => {
    expect(workOnThisProject).toContain("const displayStages = (() => {");
    expect(workOnThisProject).toContain("const list = [...stages];");
    expect(workOnThisProject).toContain("const quotationIdx = list.findIndex((s) => s.id === 'quotation');");
    expect(workOnThisProject).toContain("list.splice(quotationIdx + 1, 0, {");
    expect(workOnThisProject).toContain("id: 'loan-application',");
  });

  it('the shared engine is untouched — useProjectStage.ts LIFECYCLE has no loan-application entry and still starts Survey → Engineering → Quotation → Order (the 13-stage list the Customer Workspace timeline also consumes)', () => {
    expect(useProjectStageSrc).toMatch(/id: 'survey', projectStage: 'Survey'/);
    expect(useProjectStageSrc).toMatch(/id: 'quotation', projectStage: 'Quotation'/);
    expect(useProjectStageSrc).toMatch(/id: 'order', projectStage: 'Order'/);
    expect(useProjectStageSrc).not.toContain("projectStage: 'Loan Application'");
    // 'Loan Application' is not a canonical stage anywhere: not in the type,
    // not in PROJECT_STAGE_ORDER, so it can never be a real currentStage value.
    expect(sharedTypes).not.toMatch(/\| 'Loan Application'/);
    expect(projectLifecycle).not.toMatch(/'Loan Application',/);
  });

  it('the Loan Application card goes through the exact same ProjectStageCard shell every other card uses (same component, same props shape)', () => {
    expect(workOnThisProject).toContain('<ProjectStageCard');
    expect(workOnThisProject).toMatch(/displayStages\.map\(\(stage, index\) => \{/);
    // Same props the 13 engine cards pass: title/description/summary/status/
    // icon/illustration/action/expanded/onToggle/last, one card per stage.
    expect(stageCard).toContain('interface Props {');
    expect(stageCard).toContain('illustration?: string;');
    expect(stageCard).toContain('status: StageCardStatus;');
  });

  it('Loan Application is not registered as a full STAGE_WORKSPACES workspace (no parallel operational UI created) — it renders through the same generic real-data detail as the other non-implemented stages', () => {
    expect(stageRegistry).not.toContain('loan-application: ');
    expect(workOnThisProject).toContain('function GenericStageDetail');
  });

  it('status is derived from the REAL loan application record via a pure mapping — no record → upcoming; Payment Received/Closed → completed; Rejected → blocked; every in-flight status → attention — never invented stage semantics', () => {
    expect(workOnThisProject).toContain('function resolveLoanApplicationStatus(');
    expect(workOnThisProject).toContain("if (!reg) return 'upcoming';");
    expect(workOnThisProject).toContain("reg.status === 'Payment Received' || reg.status === 'Closed'");
    expect(workOnThisProject).toContain("if (reg.status === 'Rejected') return 'blocked';");
    expect(workOnThisProject).toContain("return 'attention';");
  });

  it('loan application data comes from the SAME useLoanApplications() hook the /loan-applications module page uses (query-keyed, deduped) — never a second query or a duplicate fetch', () => {
    expect(workOnThisProject).toContain("import { useLoanApplications } from '../../../loan-applications/hooks/useLoanApplications'");
    expect(workOnThisProject).toContain('const { data: registrations = [] } = useLoanApplications();');
    expect(workOnThisProject).not.toMatch(/getAll\(COLLECTIONS\.LOAN_APPLICATIONS|useQuery\(\{\s*\n\s*queryKey: \[[^\]]*loan_applications/);
  });

  it('the collapsed-row summary shows real loan application data (bank · status) mirroring the Survey/Engineering summary pattern', () => {
    expect(workOnThisProject).toContain("const bank = latest.bankName || 'Bank';");
    expect(workOnThisProject).toContain('const summary = latest.status ? `${bank} · ${latest.status}` : bank;');
    expect(workOnThisProject).toMatch(/stage\.id === 'loan-application' \? loanApplicationSummary : stage\.id === 'quotation' \? quotationCardSummary : stage\.id === 'order' \? orderCardSummary : stage\.id === 'procurement' \? procurementCardSummary : stage\.id === 'dispatch' \? dispatchCardSummary : stage\.id === 'installation' \? installationCardSummary : stage\.id === 'qc' \? qcCardSummary : stage\.id === 'commissioning' \? commissioningCardSummary : stage\.id === 'net-metering' \? netMeteringCardSummary : stage\.id === 'subsidy' \? subsidyCardSummary : stage\.id === 'handover' \? handoverCardSummary : stage\.id === 'amc' \? amcCardSummary : undefined/);
  });

  it('the card has the same icon + illustration treatment as the other 13 (Banknote icon, the existing registration.png art) and deep-links to the real /loan-applications module page', () => {
    expect(workOnThisProject).toContain("'loan-application': Banknote,");
    expect(workOnThisProject).toContain("'loan-application': loanApplicationIllustration,");
    expect(workOnThisProject).toContain("href: '/loan-applications',");
    expect(workOnThisProject).toContain("import loanApplicationIllustration from '../../../../assets/customer-workspace/registration.png'");
  });

  it('no duplicate Loan Application workflow was created — the card only READS loan applications (no create/update mutation, no loan application form invented inside the workspace)', () => {
    expect(workOnThisProject).not.toContain('createLoanApplication(');
    expect(workOnThisProject).not.toContain('LOAN_APPLICATION_FORM_DEFAULT');
    expect(workOnThisProject).not.toContain('onLoanApplicationStatusChange');
  });

  it('the real Loan Application workflow service remains the single source of Loan Application business logic, untouched', () => {
    expect(loanApplicationWorkflow).toContain('export async function createLoanApplication(');
    expect(loanApplicationWorkflow).toContain('COLLECTIONS.LOAN_APPLICATIONS');
  });
});
