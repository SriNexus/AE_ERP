/**
 * ProjectWorkspaceEditor — Left Panel's inline editable form for Project
 * fields (Left Panel feedback pass — Edit must be an inline panel swap,
 * the same interaction Customer/Lead Workspace already use, not a popup
 * modal).
 *
 * Single-column layout — mirrors CustomerWorkspaceEditor.tsx's own density
 * exactly (narrow ~25% column, one field per row), not ProjectForm.tsx's
 * wider FormRow-paired layout (that one stays exactly as-is for
 * Projects.tsx's own list-page modal and CustomerProjectForm.tsx's
 * embedded creation flow — untouched).
 *
 * Team assignment fix: Sales Owner/Surveyor/Installer were free-text
 * inputs — a typed name could never reliably match a real user record, so
 * the Left Panel's "call this person" action had nothing real to resolve
 * against. These are now Select dropdowns populated from the real
 * COLLECTIONS.USERS list (the same collection/query
 * CustomerWorkspaceEditor.tsx's own "Assigned Salesperson" field already
 * uses), storing the selected user's real name — the exact string
 * ProjectContextPanel's resolvePhone() looks up, so the Team section's
 * call button now has something genuine to resolve.
 *
 * Persists via the EXISTING useSaveProject/updateProject path (the same
 * mutation Projects.tsx's list page and the old modal both already used) —
 * not a new save primitive.
 */
import { Input, Select, Textarea } from '../../../../components/ui/Input';
import { PROJECT_TYPES, type ProjectFormValues, type ProjectSiteAddress } from '../../types';

interface Props {
  form: ProjectFormValues;
  onFieldChange: (field: keyof ProjectFormValues, value: string) => void;
  onAddressFieldChange: (field: keyof ProjectSiteAddress, value: string) => void;
  users: any[];
}

export default function ProjectWorkspaceEditor({ form, onFieldChange, onAddressFieldChange, users }: Props) {
  const activeUsers = users
    .filter((u: any) => u.status !== 'Inactive' && !u.isDeleted)
    .sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || '')));
  const userOptions = [{ label: 'Unassigned', value: '' }, ...activeUsers.map((u: any) => ({ label: u.name, value: u.name }))];
  const projectTypeOptions = [{ label: 'Select Project Type', value: '' }, ...PROJECT_TYPES.map((t) => ({ label: t, value: t }))];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3">
        <div className="grid grid-cols-2 gap-2">
          <Input label="Capacity (kW)" type="number" min="0" step="0.1" required value={form.capacityKw} onChange={(e) => onFieldChange('capacityKw', e.target.value)} />
          <Select label="Project Type" value={form.projectType} onChange={(e) => onFieldChange('projectType', e.target.value)} options={projectTypeOptions} />
        </div>
        <Select label="Sales Owner" value={form.salesOwner} onChange={(e) => onFieldChange('salesOwner', e.target.value)} options={userOptions} />
        <Select label="Assigned Surveyor" value={form.assignedSurveyor} onChange={(e) => onFieldChange('assignedSurveyor', e.target.value)} options={userOptions} />
        <Select label="Assigned Installer" value={form.assignedInstaller} onChange={(e) => onFieldChange('assignedInstaller', e.target.value)} options={userOptions} />
        <Textarea label="Notes" value={form.notes} onChange={(e) => onFieldChange('notes', e.target.value)} rows={3} />
      </div>
      <div className="space-y-3 border-t border-[var(--color-border)] pt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Site Address</p>
        <Input label="Address Line 1" value={form.siteAddress.line1 || ''} onChange={(e) => onAddressFieldChange('line1', e.target.value)} />
        <Input label="Address Line 2" value={form.siteAddress.line2 || ''} onChange={(e) => onAddressFieldChange('line2', e.target.value)} />
        <Input label="Landmark" value={form.siteAddress.landmark || ''} onChange={(e) => onAddressFieldChange('landmark', e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <Input label="City" value={form.siteAddress.city || ''} onChange={(e) => onAddressFieldChange('city', e.target.value)} />
          <Input label="District" value={form.siteAddress.district || ''} onChange={(e) => onAddressFieldChange('district', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input label="State" value={form.siteAddress.state || ''} onChange={(e) => onAddressFieldChange('state', e.target.value)} />
          <Input label="Pincode" value={form.siteAddress.pincode || ''} onChange={(e) => onAddressFieldChange('pincode', e.target.value)} />
        </div>
        <Input label="Country" value={form.siteAddress.country || ''} onChange={(e) => onAddressFieldChange('country', e.target.value)} />
      </div>
    </div>
  );
}
