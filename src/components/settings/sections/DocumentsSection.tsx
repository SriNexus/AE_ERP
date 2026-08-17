/**
 * DocumentsSection — Company document defaults and numbering configuration.
 *
 * P08: Real documents settings surface.
 * Stores company-scoped document defaults plus the prefixes and sequence padding
 * consumed by invoice / quotation / order generation workflows.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Save, Hash, FileText } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { useResetSettings, useSaveSettings, useSettingsSection } from '../../../features/settings/hooks/useSettingsSection';
import { DEFAULT_DOCUMENT_SETTINGS } from '../../../features/settings/defaults';
import type { DocumentSettings } from '../../../features/settings/types';
import { validateDocumentSettings } from '../../../features/settings/validation';
import { normalizeDocumentSettings, formatDocumentNumber } from '../../../features/settings/documentRuntime';
import { useUnsavedChangesGuard } from '../../../features/settings/hooks/useUnsavedChangesGuard';
import { canEditSection } from '../../../features/settings/permissions';
import { SettingsSection } from '../SettingsSection';
import { SettingsCard } from '../SettingsCard';
import { Button } from '../../ui/Button';
import { Input, Textarea } from '../../ui/Input';

function dateFromValidityDays(days: number): string {
  const target = new Date();
  target.setDate(target.getDate() + Number(days || DEFAULT_DOCUMENT_SETTINGS.piValidityDays));
  return target.toISOString().slice(0, 10);
}

export function DocumentsSection() {
  const company = useAppStore((state) => state.company || state.globalCompany || undefined);
  const query = useSettingsSection('documents');
  const save = useSaveSettings();
  const reset = useResetSettings();
  const [form, setForm] = useState<DocumentSettings>(normalizeDocumentSettings(undefined, company));

  useEffect(() => {
    if (query.data && Object.keys(query.data).length > 0) {
      setForm(normalizeDocumentSettings(query.data as Record<string, unknown>, company));
    }
  }, [company, query.data]);

  const confirmed = useMemo(() => normalizeDocumentSettings(query.data as Record<string, unknown> | undefined, company), [company, query.data]);
  const dirty = JSON.stringify(form) !== JSON.stringify(confirmed);
  useUnsavedChangesGuard(dirty);
  const validation = validateDocumentSettings(form as unknown as Record<string, unknown>);
  const editable = canEditSection('documents');

  function setField<K extends keyof DocumentSettings>(key: K, value: DocumentSettings[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  if (query.isLoading) {
    return (
      <SettingsSection title="Documents" description="Document defaults and numbering configuration" isLoading />
    );
  }

  if (query.isError) {
    return (
      <SettingsSection title="Documents" description="Document defaults and numbering configuration">
        <div className="rounded-xl border border-[var(--color-danger)] bg-[var(--color-danger-light)] p-4 text-sm text-[var(--color-danger-text)]">
          Document settings could not be loaded.
        </div>
        <Button variant="outline" onClick={() => query.refetch()}>Retry</Button>
      </SettingsSection>
    );
  }


  return (
    <SettingsSection
      title="Documents"
      description="Company defaults for document terms, validity, and new sequential document numbers."
    >
      {editable && dirty && (
        <div className="flex items-center justify-between rounded-xl border border-[var(--color-primary-muted)] bg-[var(--color-primary-light)] px-4 py-3">
          <span className="text-sm font-medium text-[var(--color-primary-text)]">You have unsaved document changes</span>
          <Button loading={save.isPending} onClick={() => save.mutateAsync({ section: 'documents', data: form as unknown as Record<string, unknown> })}>
            Save changes
          </Button>
        </div>
      )}

      <SettingsCard title="Document defaults" description="These values flow into new PIs and quotations. Historical documents stay untouched.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            type="number"
            min={1}
            max={3650}
            label="PI validity days"
            value={String(form.piValidityDays)}
            disabled={!editable}
            onChange={(event) => setField('piValidityDays', Number(event.target.value || 0))}
            error={validation.errors.piValidityDays}
          />
          <Input
            label="Sequence padding"
            type="number"
            min={2}
            max={8}
            value={String(form.sequencePadding)}
            disabled={!editable}
            onChange={(event) => setField('sequencePadding', Number(event.target.value || 0))}
            error={validation.errors.sequencePadding}
            hint="New numbers render as PREFIX-0001 style labels."
          />
          <Textarea
            label="Default terms"
            rows={6}
            value={form.defaultTerms}
            disabled={!editable}
            onChange={(event) => setField('defaultTerms', event.target.value)}
            error={validation.errors.defaultTerms}
          />
          <Textarea
            label="Default notes"
            rows={6}
            value={form.defaultNotes}
            disabled={!editable}
            onChange={(event) => setField('defaultNotes', event.target.value)}
            error={validation.errors.defaultNotes}
          />
        </div>
      </SettingsCard>

      <SettingsCard title="Numbering prefixes" description="These prefixes are used only for new document numbers.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input
            label="Invoice prefix"
            value={form.invoicePrefix}
            disabled={!editable}
            onChange={(event) => setField('invoicePrefix', event.target.value)}
            error={validation.errors.invoicePrefix}
          />
          <Input
            label="Quotation prefix"
            value={form.quotationPrefix}
            disabled={!editable}
            onChange={(event) => setField('quotationPrefix', event.target.value)}
            error={validation.errors.quotationPrefix}
          />
          <Input
            label="Order prefix"
            value={form.orderPrefix}
            disabled={!editable}
            onChange={(event) => setField('orderPrefix', event.target.value)}
            error={validation.errors.orderPrefix}
          />
        </div>
        <div className="mt-4 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-4 text-sm text-[var(--color-text-secondary)]">
          <div className="flex items-center gap-2 font-semibold text-[var(--color-text)]">
            <Hash className="h-4 w-4" />
            Live preview
          </div>
          <div className="mt-2 grid gap-1 font-mono text-xs sm:grid-cols-3">
            <span>Invoice: {formatDocumentNumber(form.invoicePrefix || confirmed.invoicePrefix, 1, form.sequencePadding || confirmed.sequencePadding)}</span>
            <span>Quotation: {formatDocumentNumber(form.quotationPrefix || confirmed.quotationPrefix, 1, form.sequencePadding || confirmed.sequencePadding)}</span>
            <span>Order: {formatDocumentNumber(form.orderPrefix || confirmed.orderPrefix, 1, form.sequencePadding || confirmed.sequencePadding)}</span>
          </div>
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">
            Next generated documents will read their prefixes and padding from this saved configuration.
          </p>
        </div>
      </SettingsCard>

      <SettingsCard title="Consumption check" description="New document defaults are reflected in the runtime workflows.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">PI validity preview</p>
            <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">New PIs stay valid for {form.piValidityDays} days</p>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Example expiry: {dateFromValidityDays(form.piValidityDays)}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Default notes</p>
            <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">New records inherit the configured note block</p>
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-[var(--color-text-secondary)]">{form.defaultNotes || 'No default notes configured.'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-[var(--color-primary-light)] px-3 py-2 text-xs text-[var(--color-primary-text)]">
          <FileText className="h-4 w-4" />
          Historical document numbers are preserved. Only new documents use the counter.
        </div>
      </SettingsCard>

      {!editable && (
        <p className="text-xs text-[var(--color-text-muted)]">You can view the company document defaults. An administrator is required to change them.</p>
      )}

      {editable && (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            icon={<RotateCcw className="h-4 w-4" />}
            loading={reset.isPending}
            onClick={async () => {
              await reset.mutateAsync('documents');
              setForm(normalizeDocumentSettings(undefined, company));
            }}
          >
            Reset
          </Button>
          <Button
            icon={<Save className="h-4 w-4" />}
            loading={save.isPending}
            disabled={!dirty || !validation.valid}
            onClick={() => save.mutateAsync({ section: 'documents', data: form as unknown as Record<string, unknown> })}
          >
            Save changes
          </Button>
        </div>
      )}
    </SettingsSection>
  );
}
