/**
 * customerQuotationFormProjectLink.test.ts — Phase 8 wiring check.
 *
 * Source-text analysis, matching this repo's established convention (see
 * customerWorkspacePhase2.test.ts and siblings) — no @testing-library/react
 * in this repository.
 *
 * CustomerQuotationForm.tsx never passed a projectId at all, even though
 * B2C's canonical flow (Blueprint §6) says every Quotation should trace to
 * a Project. Since Quotation/Project are deliberately independent one-time
 * cards (a Quotation can legitimately be created before a Project exists),
 * this is a non-blocking wiring fix — link when a Project already exists,
 * never require one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const centerPanel = read('../../features/customers/components/workspace/CustomerCenterPanel.tsx');
const quotationForm = read('../../features/customers/components/workspace/CustomerQuotationForm.tsx');

describe('CustomerCenterPanel -> CustomerQuotationForm — Phase 8 Project linkage', () => {
  it('passes the customer\'s latest existing Project id through to the Quotation form', () => {
    expect(centerPanel).toMatch(/<CustomerQuotationForm[^>]*projectId=\{latestProject\?\.id\}/);
  });

  it('CustomerQuotationForm accepts an optional projectId and forwards it into createQuotation()\'s payload', () => {
    expect(quotationForm).toContain('projectId?: string;');
    expect(quotationForm).toMatch(/projectId:\s*projectId \|\| ''/);
  });
});
