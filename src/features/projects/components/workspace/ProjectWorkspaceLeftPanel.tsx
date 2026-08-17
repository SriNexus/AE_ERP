/**
 * ProjectWorkspaceLeftPanel — Project Workspace Left Panel wrapper (Left
 * Panel feedback pass). Same title-row/Edit-button/Save-Cancel treatment
 * Lead Workspace's own Left Panel ("Lead Information") already uses — an
 * inline panel swap, not a popup modal (the earlier modal-based Edit was
 * replaced per explicit feedback: "same leads aur customer ke jaise
 * chahiye").
 */
import { Edit2, Save, X } from 'lucide-react';
import ProjectContextPanel from './ProjectContextPanel';
import ProjectWorkspaceEditor from './ProjectWorkspaceEditor';
import type { ProjectFormValues, ProjectRecord, ProjectSiteAddress } from '../../types';

interface Props {
  project: ProjectRecord;
  customerName?: string;
  projectType?: string;
  users: any[];
  canEdit: boolean;
  isEditing: boolean;
  editForm: ProjectFormValues;
  saving: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onFieldChange: (field: keyof ProjectFormValues, value: string) => void;
  onAddressFieldChange: (field: keyof ProjectSiteAddress, value: string) => void;
}

export default function ProjectWorkspaceLeftPanel({
  project, customerName, projectType, users, canEdit,
  isEditing, editForm, saving, onStartEdit, onCancelEdit, onSaveEdit, onFieldChange, onAddressFieldChange,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Project Information</h3>
        {canEdit && (
          isEditing ? (
            <div className="flex items-center gap-1">
              <button
                onClick={onSaveEdit}
                disabled={saving}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-emerald-600 transition-colors disabled:opacity-50"
              >
                <Save className="h-3 w-3" /> {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={onCancelEdit}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-[10px] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                <X className="h-3 w-3" /> Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={onStartEdit}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-primary-text)] hover:bg-[var(--color-primary-light)] transition-colors"
              title="Edit project"
            >
              <Edit2 className="h-3.5 w-3.5" />
            </button>
          )
        )}
      </div>

      {isEditing ? (
        <ProjectWorkspaceEditor form={editForm} onFieldChange={onFieldChange} onAddressFieldChange={onAddressFieldChange} users={users} />
      ) : (
        <ProjectContextPanel project={project} customerName={customerName} projectType={projectType} users={users} />
      )}
    </div>
  );
}
