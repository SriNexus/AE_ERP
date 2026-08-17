/**
 * installationBackfill — Phase 10 data-migration logic for historical
 * installation data that has only ever lived on the Lead document
 * (installationChecklist/capturedSerialNumbers/assignedEngineerId, etc.)
 * and therefore has no matching, real, Project-scoped `installations`
 * document — the same gap `installationEngine.ts`'s dual-write fix now
 * prevents going forward, for records that predate that fix.
 *
 * Pure planning logic only — mirrors the existing `orderTypeBackfill.ts`
 * pattern (compute a plan here, execute it from a thin CLI script with real
 * Firestore access). Never guesses: a Lead with real installation data but
 * no resolvable `projectId` is reported as ORPHANED, never silently dropped
 * (Zero Data Loss) — a Project-scoped record cannot exist without a Project.
 */

export const INSTALLATION_BACKFILL_COLLECTIONS = {
  LEADS: 'leads',
  INSTALLATIONS: 'installations',
} as const;

export type InstallationBackfillChecklistItem = {
  item: string;
  completed: boolean;
  completedAt?: string;
  completedBy?: string;
};

export type InstallationBackfillSerialCapture = {
  serialNumber: string;
  productId?: string;
  product?: string;
  capturedAt: string;
  capturedBy: string;
};

export type InstallationBackfillLeadRecord = {
  id: string;
  companyId?: string;
  projectId?: string;
  installationStatus?: string;
  installationChecklist?: InstallationBackfillChecklistItem[];
  capturedSerialNumbers?: InstallationBackfillSerialCapture[];
  assignedEngineerId?: string;
  assignedEngineerName?: string;
  assignedEngineerPhone?: string;
  isDeleted?: boolean;
};

export type InstallationBackfillInstallationRecord = {
  id: string;
  projectId?: string;
  isDeleted?: boolean;
};

export type InstallationBackfillInput = {
  leads: InstallationBackfillLeadRecord[];
  installations: InstallationBackfillInstallationRecord[];
};

export type InstallationBackfillOptions = {
  /** Restrict the plan to a single company. Omit to scan every company. */
  companyId?: string;
};

export type InstallationBackfillCreation = {
  leadId: string;
  projectId: string;
  companyId: string;
  installationStatus: string;
  checklist: InstallationBackfillChecklistItem[];
  capturedSerialNumbers: InstallationBackfillSerialCapture[];
  assignedEngineerId: string;
  assignedEngineerName: string;
  assignedEngineerPhone: string;
};

export type InstallationBackfillOrphanReason = 'missing_project_id';

export type InstallationBackfillOrphan = {
  leadId: string;
  companyId: string;
  reason: InstallationBackfillOrphanReason;
};

export type InstallationBackfillSummary = {
  leadsScanned: number;
  alreadyMigrated: number;
  notInstallations: number;
  toCreate: number;
  orphaned: number;
};

export type InstallationBackfillPlan = {
  creations: InstallationBackfillCreation[];
  orphaned: InstallationBackfillOrphan[];
  summary: InstallationBackfillSummary;
};

/** Same predicate as `installationEngine.ts`'s `isValidInstallation()` —
 * duplicated deliberately (this module stays dependency-free of Firestore-
 * touching code, matching `orderTypeBackfill.ts`'s self-contained style). */
function hasInstallationData(lead: InstallationBackfillLeadRecord): boolean {
  return Boolean(lead.installationStatus) && lead.installationStatus !== 'pending' && lead.isDeleted !== true;
}

/**
 * Finds every Lead with real installation progress that has no matching
 * Project-scoped `installations` document yet, and plans its creation.
 * Never guesses: a Lead with installation data but no `projectId` is placed
 * in `orphaned`, not `creations` — a Project-scoped record cannot exist
 * without a Project, and the Lead-side data is left untouched either way.
 */
export function buildInstallationBackfillPlan(
  input: InstallationBackfillInput,
  options: InstallationBackfillOptions = {}
): InstallationBackfillPlan {
  const companyFilter = String(options.companyId || '').trim();
  const existingByProjectId = new Set(
    input.installations.filter((doc) => doc.isDeleted !== true && doc.projectId).map((doc) => doc.projectId)
  );

  const creations: InstallationBackfillCreation[] = [];
  const orphaned: InstallationBackfillOrphan[] = [];
  let leadsScanned = 0;
  let alreadyMigrated = 0;
  let notInstallations = 0;

  for (const lead of input.leads) {
    if (lead.isDeleted) continue;
    const companyId = String(lead.companyId || '').trim();
    if (companyFilter && companyFilter !== companyId) continue;
    leadsScanned += 1;

    if (!hasInstallationData(lead)) {
      notInstallations += 1;
      continue;
    }

    const projectId = String(lead.projectId || '').trim();
    if (!projectId) {
      orphaned.push({ leadId: lead.id, companyId, reason: 'missing_project_id' });
      continue;
    }

    if (existingByProjectId.has(projectId)) {
      alreadyMigrated += 1;
      continue;
    }

    creations.push({
      leadId: lead.id,
      projectId,
      companyId,
      installationStatus: lead.installationStatus || 'lead_approved',
      checklist: lead.installationChecklist || [],
      capturedSerialNumbers: lead.capturedSerialNumbers || [],
      assignedEngineerId: lead.assignedEngineerId || '',
      assignedEngineerName: lead.assignedEngineerName || '',
      assignedEngineerPhone: lead.assignedEngineerPhone || '',
    });
    // A projectId can only produce one Installation doc — mirrors
    // ensureInstallationForLead()'s find-by-projectId semantics, so two
    // Leads erroneously sharing one projectId don't produce duplicates.
    existingByProjectId.add(projectId);
  }

  return {
    creations,
    orphaned,
    summary: {
      leadsScanned,
      alreadyMigrated,
      notInstallations,
      toCreate: creations.length,
      orphaned: orphaned.length,
    },
  };
}

export function formatInstallationBackfillSummary(summary: InstallationBackfillSummary): string {
  return [
    `Leads scanned: ${summary.leadsScanned}`,
    `Not installations (no progress yet): ${summary.notInstallations}`,
    `Already migrated: ${summary.alreadyMigrated}`,
    `Installation docs to create: ${summary.toCreate}`,
    `Orphaned (cannot safely migrate, left untouched): ${summary.orphaned}`,
  ].join('\n');
}
