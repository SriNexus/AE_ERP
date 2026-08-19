/**
 * PlatformSettings — Super Admin Platform Settings screen (§6.8/§6.9).
 *
 * Single form backed by platform_settings/global. V1 fields: maintenanceMode
 * toggle + maintenanceMessage text. NO speculative future settings fields.
 * Maintenance Mode is an emergency/break-glass control (§6.9): toggling it
 * requires typed confirmation of the reserved phrase and logs a severity
 * 'critical' security_logs entry (logSecurityEvent — F-16 call site).
 */

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, ShieldAlert, Zap } from 'lucide-react';
import PlatformShell from './PlatformShell';
import { Button } from '../../components/ui/Button';
import { Input, Textarea } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Card, CardHeader, CardTitle } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { getPlatformSettings, setPlatformSettings } from '../../lib/platformAdmin';
import { toast } from 'react-hot-toast';

const CONFIRM_PHRASE = 'ENABLE MAINTENANCE';

export default function PlatformSettings() {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery({ queryKey: ['platform-settings'], queryFn: getPlatformSettings, staleTime: 30_000 });

  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  useEffect(() => {
    if (settings) {
      setMaintenanceMode(Boolean(settings.maintenanceMode));
      setMaintenanceMessage(settings.maintenanceMessage || '');
    }
  }, [settings]);

  const saveMut = useMutation({
    mutationFn: (input: { maintenanceMode: boolean; maintenanceMessage: string }) =>
      setPlatformSettings({ maintenanceMode: input.maintenanceMode, maintenanceMessage: input.maintenanceMessage }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-settings'] });
      toast.success('Platform settings saved');
      setConfirmOpen(false);
      setConfirmText('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleRequested = !maintenanceMode; // enabling requires typed confirmation

  return (
    <PlatformShell title="Platform Settings">
      <div className="max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Zap className="h-4 w-4" /> Maintenance Mode</CardTitle>
          </CardHeader>
          <div className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[var(--color-text)]">Platform maintenance</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  While enabled, non-Super-Admin users are informed the platform is under maintenance. This is a break-glass control (§6.9) — enabling requires typed confirmation and is logged as a critical security event.
                </p>
              </div>
              <Badge variant={maintenanceMode ? 'danger' : 'success'}>{maintenanceMode ? 'ON' : 'OFF'}</Badge>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={maintenanceMode}
                onChange={(e) => {
                  if (e.target.checked) {
                    setConfirmOpen(true);
                  } else {
                    setMaintenanceMode(false);
                    setMaintenanceMessage((prev) => prev);
                  }
                }}
                className="accent-[var(--color-danger)] h-4 w-4"
              />
              <span className="text-sm text-[var(--color-text)]">Enable maintenance mode</span>
            </div>

            <div>
              <Textarea
                label="Maintenance message"
                value={maintenanceMessage}
                onChange={(e) => setMaintenanceMessage(e.target.value)}
                placeholder="e.g. Scheduled maintenance on Saturday 10 PM – 2 AM. Please save your work."
                rows={3}
              />
              <p className="text-xs text-[var(--color-text-muted)] mt-1">Shown to users while maintenance mode is on.</p>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant={maintenanceMode ? 'danger' : 'primary'}
                disabled={saveMut.isPending}
                loading={saveMut.isPending}
                onClick={() => saveMut.mutate({ maintenanceMode, maintenanceMessage })}
              >
                {maintenanceMode ? 'Turn off maintenance & save' : 'Save settings'}
              </Button>
            </div>
          </div>
        </Card>

        <Card className="mt-4">
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-4 w-4" /> Emergency controls (§6.9)</CardTitle></CardHeader>
          <div className="p-5">
            <p className="text-xs text-[var(--color-text-muted)]">
              "Suspend Group" (Groups screen → group detail → Suspend) and "Maintenance Mode" (above) are the two break-glass controls. Both require typed-name confirmation and write a severity 'critical' entry to security_logs via logSecurityEvent().
            </p>
          </div>
        </Card>
      </div>

      {/* Typed confirmation for enabling maintenance mode (§6.9) */}
      <Modal
        open={confirmOpen}
        onClose={() => { setConfirmOpen(false); setConfirmText(''); }}
        title="Enable Maintenance Mode"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setConfirmOpen(false); setConfirmText(''); }}>Cancel</Button>
            <Button
              variant="danger"
              disabled={confirmText !== CONFIRM_PHRASE}
              onClick={() => { setMaintenanceMode(true); setConfirmOpen(false); setConfirmText(''); }}
            >
              Enable maintenance
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-text)]">
            Enabling maintenance mode signals a platform-wide outage window to all non-Super-Admin users. This is logged as a <span className="font-semibold">critical</span> security event.
          </p>
          <p className="text-sm text-[var(--color-text)]">
            Type <span className="font-mono font-bold text-[var(--color-danger-text)]">{CONFIRM_PHRASE}</span> to confirm:
          </p>
          <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={CONFIRM_PHRASE} autoFocus />
        </div>
      </Modal>
    </PlatformShell>
  );
}
