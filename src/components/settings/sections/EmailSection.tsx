import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, PlayCircle, RotateCcw, Save } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { useResetSettings, useSaveSettings, useSettingsSection } from '../../../features/settings/hooks/useSettingsSection';
import { DEFAULT_EMAIL_SETTINGS } from '../../../features/settings/defaults';
import type { EmailSettings, EmailTemplateKey } from '../../../features/settings/types';
import { validateEmailSettings } from '../../../features/settings/validation';
import { EMAIL_TEMPLATE_DEFINITIONS, interpolateEmailTemplate, normalizeEmailSettings } from '../../../features/settings/emailRuntime';
import { useUnsavedChangesGuard } from '../../../features/settings/hooks/useUnsavedChangesGuard';
import { canEditSection } from '../../../features/settings/permissions';
import { SettingsSection } from '../SettingsSection';
import { SettingsCard } from '../SettingsCard';
import { Button } from '../../ui/Button';
import { Input, Textarea } from '../../ui/Input';
import { cn } from '../../../utils/cn';

function samplePreview(templateKey: EmailTemplateKey, settings: EmailSettings, companyName: string) {
  const definition = EMAIL_TEMPLATE_DEFINITIONS[templateKey];
  const variables = { ...definition.sampleVariables, companyName: companyName || definition.sampleVariables.companyName };
  return {
    subject: interpolateEmailTemplate(settings.templates[templateKey].subjectTemplate, variables).text,
    body: interpolateEmailTemplate(settings.templates[templateKey].bodyTemplate, variables).text,
  };
}

export function EmailSection() {
  const company = useAppStore((state) => state.company || state.globalCompany || undefined);
  const query = useSettingsSection('email');
  const save = useSaveSettings();
  const reset = useResetSettings();
  const [form, setForm] = useState<EmailSettings>(DEFAULT_EMAIL_SETTINGS);

  useEffect(() => {
    if (query.data && Object.keys(query.data).length > 0) {
      setForm(normalizeEmailSettings(query.data as Record<string, unknown>));
    }
  }, [query.data]);

  const confirmed = useMemo(() => normalizeEmailSettings(query.data as Record<string, unknown> | undefined), [query.data]);
  const dirty = JSON.stringify(form) !== JSON.stringify(confirmed);
  useUnsavedChangesGuard(dirty);
  const validation = validateEmailSettings(form as unknown as Record<string, unknown>);
  const editable = canEditSection('email');

  function setField<K extends keyof EmailSettings>(key: K, value: EmailSettings[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setTemplateField(templateKey: EmailTemplateKey, field: 'enabled' | 'displayName' | 'subjectTemplate' | 'bodyTemplate', value: string | boolean) {
    setForm((current) => ({
      ...current,
      templates: {
        ...current.templates,
        [templateKey]: {
          ...current.templates[templateKey],
          [field]: value,
        },
      },
    }));
  }

  function fieldError(path: string) {
    return validation.errors[path];
  }

  if (query.isLoading) {
    return <div className="h-72 animate-pulse rounded-xl bg-[var(--color-bg-sunken)]" />;
  }

  if (query.isError) {
    return (
      <SettingsSection title="Email" description="Reusable Gmail compose templates and delivery defaults.">
        <div className="rounded-xl border border-[var(--color-danger)] p-5">
          <p className="text-sm text-[var(--color-danger)]">Email settings could not be loaded.</p>
          <Button className="mt-3" variant="outline" onClick={() => query.refetch()}>Retry</Button>
        </div>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title="Email"
      description="Reusable Gmail compose templates for quotations, invoices, orders, and payment reminders. No provider credentials are required."
    >
      <SettingsCard title="How email works" description="Clicking Send Email in ERP opens Gmail compose with the recipient, subject, and body prefilled. Gmail still controls the final Send action.">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-4 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Workflow</p>
            <p className="mt-1 font-semibold text-[var(--color-text)]">Explicit click only</p>
          </div>
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-4 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Delivery</p>
            <p className="mt-1 font-semibold text-[var(--color-text)]">Manual send in Gmail</p>
          </div>
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-4 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Secrets</p>
            <p className="mt-1 font-semibold text-[var(--color-text)]">None required</p>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="Shared template settings" description="These defaults are stored in the company-scoped Email Settings document.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Default sender name"
            value={form.fromName}
            disabled={!editable}
            onChange={(event) => setField('fromName', event.target.value)}
            error={validation.errors.fromName}
          />
          <Input
            label="Reply-to email"
            type="email"
            value={form.replyTo}
            disabled={!editable}
            onChange={(event) => setField('replyTo', event.target.value)}
            error={validation.errors.replyTo}
          />
        </div>
      </SettingsCard>

      <div className="space-y-4">
        {Object.entries(EMAIL_TEMPLATE_DEFINITIONS).map(([templateKey, definition]) => {
          const key = templateKey as EmailTemplateKey;
          const preview = samplePreview(key, form, company?.name || 'Company');
          const template = form.templates[key];
          const subjectError = fieldError(`templates.${key}.subjectTemplate`);
          const bodyError = fieldError(`templates.${key}.bodyTemplate`);
          const nameError = fieldError(`templates.${key}.displayName`);
          return (
            <SettingsCard key={key} title={definition.label} description={definition.description}>
              <div className="space-y-4">
                <label className="flex items-center justify-between gap-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                  <span className="text-sm font-medium text-[var(--color-text)]">Enable this template</span>
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-[var(--color-primary)]"
                    checked={template.enabled}
                    disabled={!editable}
                    onChange={(event) => setTemplateField(key, 'enabled', event.target.checked)}
                  />
                </label>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Input
                    label="Template name"
                    value={template.displayName}
                    disabled={!editable}
                    onChange={(event) => setTemplateField(key, 'displayName', event.target.value)}
                    error={nameError}
                  />
                  <Input
                    label="Subject template"
                    value={template.subjectTemplate}
                    disabled={!editable}
                    onChange={(event) => setTemplateField(key, 'subjectTemplate', event.target.value)}
                    error={subjectError}
                  />
                </div>
                <Textarea
                  label="Body template"
                  rows={8}
                  value={template.bodyTemplate}
                  disabled={!editable}
                  onChange={(event) => setTemplateField(key, 'bodyTemplate', event.target.value)}
                  error={bodyError}
                />
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
                  <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-text-secondary)]">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                      <PlayCircle className="h-4 w-4" />
                      Preview
                    </div>
                    <p className="mt-3 font-semibold text-[var(--color-text)]">Subject: {preview.subject}</p>
                    <p className="mt-2 whitespace-pre-wrap rounded-lg bg-[var(--color-bg-sunken)] p-3 text-xs leading-relaxed text-[var(--color-text-secondary)]">{preview.body}</p>
                  </div>
                  <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-4 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Supported variables</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {definition.supportedVariables.map((variable) => (
                        <span key={variable} className={cn('rounded-full border px-2.5 py-1 text-xs font-semibold', 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)]')}>
                          {'{{' + variable + '}}'}
                        </span>
                      ))}
                    </div>
                    <div className="mt-4 flex items-center gap-2 rounded-lg bg-[var(--color-primary-light)] px-3 py-2 text-xs text-[var(--color-primary-text)]">
                      <CheckCircle2 className="h-4 w-4" />
                      Unsupported placeholders are rejected before Gmail opens.
                    </div>
                  </div>
                </div>
              </div>
            </SettingsCard>
          );
        })}
      </div>

      {!editable && <p className="text-xs text-[var(--color-text-muted)]">You can view the company email templates. An administrator is required to change them.</p>}

      {editable && (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            icon={<RotateCcw className="h-4 w-4" />}
            loading={reset.isPending}
            onClick={async () => {
              await reset.mutateAsync('email');
              setForm(DEFAULT_EMAIL_SETTINGS);
            }}
          >
            Reset
          </Button>
          <Button
            icon={<Save className="h-4 w-4" />}
            loading={save.isPending}
            disabled={!dirty || !validation.valid}
            onClick={() => save.mutateAsync({ section: 'email', data: form as unknown as Record<string, unknown> })}
          >
            Save changes
          </Button>
        </div>
      )}
    </SettingsSection>
  );
}
