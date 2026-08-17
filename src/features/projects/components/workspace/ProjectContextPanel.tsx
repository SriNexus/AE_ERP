/**
 * ProjectContextPanel — Left Panel's permanent Project Information content
 * (Project Workspace Phase 2 Completion & Structure Fix mission — full
 * information-hierarchy redesign, replacing the earlier structure-only
 * pass's flatter cluster set).
 *
 * Read-only display — editing happens via the Left Panel wrapper's Edit
 * button, which opens the existing Project edit flow (ProjectForm +
 * useSaveProject, the same modal Projects.tsx's own list page already
 * uses) rather than an inline draft model invented for this pass.
 *
 * Redundancy fix: Capacity is already shown in the Header (capacity chip)
 * and isn't repeated here. The complete Project address IS shown below
 * (Survey Final Production Fix mission — the Header intentionally stays
 * city-only, but the detailed Project Information panel needs the full
 * registered address, reusing projectSiteAddressSummary(), the same
 * formatter ProjectDetailModal's own Site Address card already uses).
 *
 * "Address" (this Project's own registered address) and "Surveyed
 * Location" (where a Survey's GPS was actually captured) are deliberately
 * separate clusters below — related concepts, never conflated or
 * overwriting one another.
 *
 * Project Type (Residential/Commercial/Industrial) is a real field on the
 * Project record itself (project.projectType) — passed in as a prop by the
 * page (sourced directly from project.projectType, not derived from the
 * linked Customer).
 *
 * Team section resolves each assigned person's phone number via the
 * already-fetched `users` list (COLLECTIONS.USERS — the same collection
 * CustomerWorkspaceEditor.tsx's own salesperson dropdown already queries),
 * matched by name since Project only stores plain name strings for
 * assignedSurveyor/assignedInstaller/salesOwner (no id field exists to join
 * on). When no match is found, the phone action is simply omitted — never
 * a fabricated number.
 */
import { useNavigate } from 'react-router-dom';
import { Home, User, FileText, ArrowUpRight, Phone, MapPin } from 'lucide-react';
import { projectSiteAddressSummary } from '../../utils/projectDisplay';
import type { ProjectRecord } from '../../types';

interface Props {
  project: ProjectRecord;
  customerName?: string;
  projectType?: string;
  users: any[];
}

function Cluster({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{label}</h4>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function IconRow({ icon, value, hint }: { icon: React.ReactNode; value: React.ReactNode; hint?: string }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-[var(--color-text-muted)]">{icon}</span>
      <span className="min-w-0 flex-1 text-[12.5px] font-medium text-[var(--color-text)] break-words leading-5">
        {value}
        {hint && <span className="ml-1.5 text-[10px] font-normal text-[var(--color-text-muted)]">{hint}</span>}
      </span>
    </div>
  );
}

function LinkRow({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 text-left text-[12.5px] font-medium text-[var(--color-primary)] hover:underline"
    >
      <span className="shrink-0 text-[var(--color-text-muted)]">{icon}</span>
      <span className="flex-1">{label}</span>
      <ArrowUpRight className="h-3 w-3 shrink-0" />
    </button>
  );
}

/** Name / role / clickable phone — the same `tel:` pattern the Header's own
 * Call action already uses, not plain text. Phone is omitted (never faked)
 * when no matching user record is found. */
function TeamMemberRow({ name, role, phone }: { name: string; role: string; phone?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-[var(--color-text)] truncate">{name}</p>
        <p className="text-[10px] text-[var(--color-text-muted)]">{role}</p>
      </div>
      {phone && (
        <a
          href={`tel:${phone}`}
          title={`Call ${name}`}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)] transition-colors shadow-sm"
        >
          <Phone className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}

/** Best-effort name → phone lookup against the already-fetched users list
 * — the only linkage available, since Project stores team assignment as
 * plain name strings, not user ids. Returns undefined (no fake data) when
 * nothing matches. */
function resolvePhone(name: string | undefined, users: any[]): string | undefined {
  if (!name) return undefined;
  const match = users.find((u) => String(u.name || '').trim().toLowerCase() === name.trim().toLowerCase());
  return match?.phone || undefined;
}

export default function ProjectContextPanel({ project, customerName, projectType, users }: Props) {
  const navigate = useNavigate();
  const team = [
    { name: project.salesOwner, role: 'Sales Owner' },
    { name: project.assignedSurveyor, role: 'Surveyor' },
    { name: project.assignedInstaller, role: 'Installer' },
  ].filter((m) => m.name);

  return (
    <div className="divide-y divide-[var(--color-border-subtle)] [&>*+*]:mt-4 [&>*+*]:pt-4">
      <Cluster label="Project">
        <p className="text-[13px] font-bold text-[var(--color-text)] leading-tight">{project.projectId || project.id}</p>
        {projectType && <IconRow icon={<Home className="h-3 w-3" />} value={projectType} hint="Type" />}
      </Cluster>

      {projectSiteAddressSummary(project.siteAddress) !== '—' && (
        <Cluster label="Address">
          <p className="text-[12.5px] font-medium leading-5 text-[var(--color-text)]">{projectSiteAddressSummary(project.siteAddress)}</p>
        </Cluster>
      )}

      {customerName && (
        <Cluster label="Customer">
          <LinkRow icon={<User className="h-3 w-3" />} label={customerName} onClick={() => navigate(`/customers/${encodeURIComponent(project.customerId)}`)} />
        </Cluster>
      )}

      {team.length > 0 && (
        <Cluster label="Team">
          <div className="divide-y divide-[var(--color-border-subtle)]">
            {team.map((m) => (
              <TeamMemberRow key={m.role} name={m.name as string} role={m.role} phone={resolvePhone(m.name, users)} />
            ))}
          </div>
        </Cluster>
      )}

      {project.siteAddress?.latitude != null && project.siteAddress?.longitude != null && (
        <Cluster label="Surveyed Location">
          <p className="text-[12.5px] font-medium leading-5 text-[var(--color-text)]">
            {project.siteAddress.surveyedLocationLabel || 'Address unavailable'}
          </p>
          <LinkRow
            icon={<MapPin className="h-3 w-3" />}
            label={`${project.siteAddress.latitude.toFixed(5)}, ${project.siteAddress.longitude.toFixed(5)}`}
            onClick={() => window.open(`https://www.google.com/maps?q=${project.siteAddress.latitude},${project.siteAddress.longitude}`, '_blank', 'noopener,noreferrer')}
          />
        </Cluster>
      )}

      {project.notes && (
        <Cluster label="Notes">
          <p className="text-[12px] text-[var(--color-text-secondary)] leading-5 whitespace-pre-wrap">{project.notes}</p>
        </Cluster>
      )}

      {project.leadId && (
        <Cluster label="Source">
          <LinkRow icon={<FileText className="h-3 w-3" />} label="View source lead" onClick={() => navigate(`/leads/workspace/${encodeURIComponent(project.leadId as string)}`)} />
        </Cluster>
      )}
    </div>
  );
}
