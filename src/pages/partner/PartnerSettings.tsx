/**
 * PartnerSettings — Placeholder page for the Partner Settings
 * Full implementation in Phase 7.6
 */

import { PageShell } from '../../components/shared/PageShell';
import { EmptyState } from '../../components/shared/EmptyState';
import { Settings } from 'lucide-react';

export default function PartnerSettings() {
  return (
    <PageShell
      title="Settings"
      subtitle="Notification preferences and account settings"
      icon={<Settings className="h-5 w-5" />}
    >
      <EmptyState
        icon={<Settings className="h-12 w-12" />}
        title="Settings"
        description="Notification preferences and account settings will be available here."
      />
    </PageShell>
  );
}
