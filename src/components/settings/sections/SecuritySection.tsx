/**
 * SecuritySection — Security settings with password change and user info.
 *
 * Phase 1: Basic password change via Firebase Auth.
 * Future phases: MFA, session management, login history.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { auth } from '../../../lib/firebase';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { useCurrentUser } from '../../../store/useAppStore';
import { useDefaultCompany } from '../../../features/company/hooks/useDefaultCompany';
import { SettingsSection } from '../SettingsSection';
import { SettingsCard } from '../SettingsCard';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';

export function SecuritySection() {
  const user = useCurrentUser();
  const { company } = useDefaultCompany();
  const [showPwdModal, setShowPwdModal] = useState(false);
  const [pwdForm, setPwdForm] = useState({ current: '', new: '', confirm: '' });
  const [pwdLoading, setPwdLoading] = useState(false);

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    if (pwdForm.new !== pwdForm.confirm) return toast.error('New passwords do not match');
    if (pwdForm.new.length < 6) return toast.error('Password must be at least 6 characters');
    setPwdLoading(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser || !currentUser.email) throw new Error('No active user session');
      const credential = EmailAuthProvider.credential(currentUser.email, pwdForm.current);
      await reauthenticateWithCredential(currentUser, credential);
      await updatePassword(currentUser, pwdForm.new);
      toast.success('Password updated successfully');
      setShowPwdModal(false);
      setPwdForm({ current: '', new: '', confirm: '' });
    } catch (err: any) {
      toast.error(err.message || 'Failed to update password');
    } finally {
      setPwdLoading(false);
    }
  }

  return (
    <SettingsSection
      title="Security"
      description="Password, sessions & account protection"
    >
      <SettingsCard title="Account">
        <div className="space-y-3">
          <Input label="Current User" value={user.name} disabled className="bg-[var(--color-bg-sunken)]" />
          <Input label="Email" value={user.email} disabled className="bg-[var(--color-bg-sunken)]" />
          <Input label="Role" value={user.role} disabled className="bg-[var(--color-bg-sunken)]" />
          <Input label="Company" value={company?.name || '—'} disabled className="bg-[var(--color-bg-sunken)]" />
          <div className="pt-2">
            <Button variant="outline" size="sm" onClick={() => setShowPwdModal(true)}>
              Change Password
            </Button>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="Firebase Security">
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4 text-sm text-amber-700 dark:text-amber-300">
          <p className="font-semibold mb-1">⚠️ Data Security</p>
          <p className="text-xs">
            All data is stored in Firebase Firestore with offline persistence (IndexedDB).
            Configure security rules in the Firebase Console. Future phases will add MFA,
            session management, and login history.
          </p>
        </div>
      </SettingsCard>

      <SettingsCard title="Data Management">
        <div className="flex gap-3">
          <Button variant="outline" size="sm" onClick={() => toast('Export initiated')}>
            Export All Data (JSON)
          </Button>
          <Button variant="danger" size="sm" onClick={() => toast.error('Contact admin to purge data')}>
            Purge Cache
          </Button>
        </div>
      </SettingsCard>

      <Modal open={showPwdModal} onClose={() => setShowPwdModal(false)} title="Change Password" size="sm">
        <form onSubmit={handlePasswordChange} className="space-y-4">
          <Input label="Current Password" type="password" required value={pwdForm.current}
            onChange={e => setPwdForm({ ...pwdForm, current: e.target.value })} />
          <Input label="New Password" type="password" required value={pwdForm.new}
            onChange={e => setPwdForm({ ...pwdForm, new: e.target.value })} />
          <Input label="Confirm New Password" type="password" required value={pwdForm.confirm}
            onChange={e => setPwdForm({ ...pwdForm, confirm: e.target.value })} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setShowPwdModal(false)}>Cancel</Button>
            <Button type="submit" loading={pwdLoading}>Update Password</Button>
          </div>
        </form>
      </Modal>
    </SettingsSection>
  );
}
