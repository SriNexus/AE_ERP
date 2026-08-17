/**
 * AboutErpSection — Settings → About ERP.
 * Universal section (every authenticated user, see features/settings/permissions.ts).
 * Adds the two things this section was missing: a real interactive User
 * Guide, and a clear version indicator (src/config/appVersion.ts).
 */
import { useState } from 'react';
import { BookOpen, Info, Sparkles, GraduationCap } from 'lucide-react';
import { SettingsSection } from '../SettingsSection';
import { SettingsCard } from '../SettingsCard';
import { Button } from '../../ui/Button';
import { useDefaultCompany } from '../../../features/company/hooks/useDefaultCompany';
import { useCurrentUser } from '../../../store/useAppStore';
import { APP_NAME, APP_DISPLAY_VERSION } from '../../../config/appVersion';
import { UserGuide } from '../../../features/guide/UserGuide';
import { TutorialCenter } from '../../../features/tutorials';

export function AboutErpSection() {
  const [guideOpen, setGuideOpen] = useState(false);
  const [tutorialsOpen, setTutorialsOpen] = useState(false);
  const user = useCurrentUser();
  const { company } = useDefaultCompany();

  return (
    <SettingsSection title="About ERP" description="What Neozy is, your version, and the built-in User Guide">
      <SettingsCard>
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary-light)] text-[var(--color-primary-text)]">
            <Sparkles className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[var(--color-text)]">{APP_NAME}</h3>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              A connected Solar EPC ERP — sales, field operations, procurement, inventory, and after-sales service in one system.
            </p>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="User Guide">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <p className="text-sm text-[var(--color-text-secondary)]">
              An interactive, built-in guide to Neozy — what each module does, how records connect, common
              step-by-step tasks, and direct links to the real pages you need.
            </p>
          </div>
          <Button icon={<BookOpen className="h-4 w-4" />} onClick={() => setGuideOpen(true)}>
            Open User Guide
          </Button>
        </div>
      </SettingsCard>

      <SettingsCard title="Tutorials">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <p className="text-sm text-[var(--color-text-secondary)]">
              Step-by-step interactive training on the real ERP screens — spotlighted controls, guided
              workflows, and saved progress. Pick a tutorial, press Start, and learn by doing.
            </p>
          </div>
          <Button variant="outline" icon={<GraduationCap className="h-4 w-4" />} onClick={() => setTutorialsOpen(true)}>
            Browse Tutorials
          </Button>
        </div>
      </SettingsCard>

      <SettingsCard title="System Information">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5" /> Version
            </p>
            <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">{APP_DISPLAY_VERSION}</p>
          </div>
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Your Role</p>
            <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">{user?.role || 'Not available'}</p>
          </div>
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Company</p>
            <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">{company?.name || 'Not configured'}</p>
          </div>
        </div>
      </SettingsCard>

      <UserGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
      <TutorialCenter open={tutorialsOpen} onClose={() => setTutorialsOpen(false)} />
    </SettingsSection>
  );
}

export default AboutErpSection;
