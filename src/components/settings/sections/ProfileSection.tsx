/**
 * ProfileSection — My Profile settings.
 *
 * Canonical owner: users/{userId} + Firebase Auth email.
 * Self-service only. No disconnected settings document.
 */

import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { auth } from '../../../lib/firebase';
import { EmailAuthProvider, reauthenticateWithCredential, sendPasswordResetEmail, updatePassword } from 'firebase/auth';
import { useUnsavedChangesGuard } from '../../../features/settings/hooks/useUnsavedChangesGuard';
import { useMyProfile } from '../../../features/settings/hooks/useMyProfile';
import { useAppStore } from '../../../store/useAppStore';
import { SettingsSection } from '../SettingsSection';
import { SettingsCard } from '../SettingsCard';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import type { UserProfileSaveInput } from '../../../lib/userProfile';

const MAX_FILE_BYTES = 2 * 1024 * 1024;

const EMPTY_FORM = {
  displayName: '',
  email: '',
  phone: '',
};

function fileToObjectUrl(file: File): string {
  return URL.createObjectURL(file);
}

function isValidImageFile(file: File): boolean {
  return file.type.startsWith('image/') && file.size <= MAX_FILE_BYTES;
}

export function ProfileSection() {
  const currentUser = useAppStore((state) => state.user);
  const { profileQuery, saveMutation, refresh } = useMyProfile();

  const [form, setForm] = useState(EMPTY_FORM);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | undefined>(undefined);
  const [signaturePreview, setSignaturePreview] = useState<string | undefined>(undefined);
  const [isDirty, setIsDirty] = useState(false);
  useUnsavedChangesGuard(isDirty);

  const [showPwdModal, setShowPwdModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [pwdForm, setPwdForm] = useState({ current: '', new: '', confirm: '' });
  const [pwdLoading, setPwdLoading] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);

  const [showEmailConfirm, setShowEmailConfirm] = useState(false);
  const [emailPassword, setEmailPassword] = useState('');
  const loadedProfile = profileQuery.data;

  useEffect(() => {
    if (!loadedProfile || isDirty) return;
    setForm({
      displayName: loadedProfile.displayName || loadedProfile.name || currentUser?.displayName || currentUser?.name || '',
      email: loadedProfile.email || currentUser?.email || '',
      phone: loadedProfile.phone || currentUser?.phone || '',
    });
    setAvatarPreview(loadedProfile.avatarUrl);
    setSignaturePreview(loadedProfile.signatureUrl);
    setAvatarFile(null);
    setSignatureFile(null);
    setResetEmail(loadedProfile.email || currentUser?.email || '');
    setShowEmailConfirm(false);
    setEmailPassword('');
    setResetSent(false);
  }, [loadedProfile, isDirty, currentUser]);

  const emailChanged = useMemo(() => {
    if (!loadedProfile) return false;
    return form.email.trim().toLowerCase() !== loadedProfile.email.trim().toLowerCase();
  }, [form.email, loadedProfile]);

  function patchForm(patch: Partial<typeof form>) {
    setForm((prev) => ({ ...prev, ...patch }));
    setIsDirty(true);
  }

  function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isValidImageFile(file)) {
      toast.error('Avatar must be an image under 2 MB');
      return;
    }
    setAvatarFile(file);
    setAvatarPreview(fileToObjectUrl(file));
    setIsDirty(true);
  }

  function handleSignatureUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isValidImageFile(file)) {
      toast.error('Signature must be an image under 2 MB');
      return;
    }
    setSignatureFile(file);
    setSignaturePreview(fileToObjectUrl(file));
    setIsDirty(true);
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    if (pwdForm.new !== pwdForm.confirm) return toast.error('New passwords do not match');
    if (pwdForm.new.length < 6) return toast.error('Password must be at least 6 characters');
    setPwdLoading(true);
    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser || !firebaseUser.email) throw new Error('No active user session');
      const credential = EmailAuthProvider.credential(firebaseUser.email, pwdForm.current);
      await reauthenticateWithCredential(firebaseUser, credential);
      await updatePassword(firebaseUser, pwdForm.new);
      toast.success('Password updated successfully');
      setShowPwdModal(false);
      setPwdForm({ current: '', new: '', confirm: '' });
    } catch (error: any) {
      if (error.code === 'auth/wrong-password') {
        toast.error('Current password is incorrect');
      } else if (error.code === 'auth/weak-password') {
        toast.error('Password is too weak. Use at least 6 characters');
      } else if (error.code === 'auth/requires-recent-login') {
        toast.error('Please log out and log back in before changing your password');
      } else {
        toast.error(error.message || 'Failed to update password');
      }
    } finally {
      setPwdLoading(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!resetEmail) return toast.error('Please enter your email address');
    setPwdLoading(true);
    try {
      await sendPasswordResetEmail(auth, resetEmail);
      setResetSent(true);
      toast.success('Password reset link sent');
    } catch (error: any) {
      if (error.code === 'auth/user-not-found') {
        setResetSent(true);
      } else if (error.code === 'auth/invalid-email') {
        toast.error('Invalid email address');
      } else {
        toast.error(error.message || 'Failed to send reset email');
      }
    } finally {
      setPwdLoading(false);
    }
  }

  function resetDraft() {
    if (!loadedProfile) return;
    setForm({
      displayName: loadedProfile.displayName || loadedProfile.name || '',
      email: loadedProfile.email || '',
      phone: loadedProfile.phone || '',
    });
    setAvatarPreview(loadedProfile.avatarUrl);
    setSignaturePreview(loadedProfile.signatureUrl);
    setAvatarFile(null);
    setSignatureFile(null);
    setIsDirty(false);
    setEmailPassword('');
    setShowEmailConfirm(false);
  }

  async function commitSave(currentPassword?: string) {
    if (!loadedProfile) return;
    const payload: UserProfileSaveInput = {
      displayName: form.displayName,
      email: form.email,
      phone: form.phone,
      avatarFile,
      signatureFile,
      currentPassword,
    };
    const saved = await saveMutation.mutateAsync(payload);
    setForm({
      displayName: saved.displayName || saved.name || '',
      email: saved.email || '',
      phone: saved.phone || '',
    });
    setAvatarPreview(saved.avatarUrl);
    setSignaturePreview(saved.signatureUrl);
    setAvatarFile(null);
    setSignatureFile(null);
    setIsDirty(false);
    setShowEmailConfirm(false);
    setEmailPassword('');
    try {
      await refresh();
    } catch {
      // best-effort cache refresh only
    }
  }

  async function handleSaveClick() {
    if (!loadedProfile) return;
    if (emailChanged) {
      setShowEmailConfirm(true);
      return;
    }
    try {
      await commitSave();
    } catch {
      // mutation already surfaced the error toast
    }
  }

  async function handleEmailConfirmSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!emailPassword.trim()) {
      toast.error('Enter your current password to confirm the email change');
      return;
    }
    try {
      await commitSave(emailPassword);
    } catch {
      // handled by mutation toast; keep the modal open so the user can retry
    }
  }

  if (profileQuery.isLoading) {
    return <SettingsSection title="My Profile" isLoading />;
  }

  if (profileQuery.isError || !loadedProfile) {
    const message = profileQuery.error instanceof Error ? profileQuery.error.message : 'Unable to load your profile.';
    return (
      <SettingsSection title="My Profile" description="Manage your personal identity details.">
        <div className="rounded-xl border border-[var(--color-danger)] bg-[var(--color-danger-light)] p-4 text-sm text-[var(--color-danger-text)]">
          <p className="font-semibold">Profile unavailable</p>
          <p className="mt-1 whitespace-pre-line">{message}</p>
          <div className="mt-4">
            <Button variant="outline" onClick={() => { void refresh(); }}>Retry</Button>
          </div>
        </div>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title="My Profile"
      description="Manage your photo, name, login email, and password"
      className="mx-auto w-full max-w-6xl"
    >
      {isDirty ? (
        <div className="mb-5 flex flex-col gap-3 rounded-xl border border-[var(--color-primary-muted)] bg-[var(--color-primary-light)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm font-medium text-[var(--color-primary-text)]">You have unsaved profile changes</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={resetDraft} disabled={saveMutation.isPending}>Reset</Button>
            <Button onClick={() => { void handleSaveClick(); }} loading={saveMutation.isPending}>Save Profile</Button>
          </div>
        </div>
      ) : null}

      <SettingsCard title="Profile Photo" description="This photo appears in your header and account menu." className="overflow-hidden">
        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <div className="relative">
            {avatarPreview ? (
              <img src={avatarPreview} alt="Profile" className="h-28 w-28 rounded-full border-2 border-[var(--color-border)] object-cover shadow-sm" />
            ) : (
              <div className="flex h-28 w-28 items-center justify-center rounded-full border-2 border-[var(--color-border)] bg-[var(--color-primary-light)] text-2xl font-bold text-[var(--color-primary-text)] shadow-sm">
                {(form.displayName || 'U')[0].toUpperCase()}
              </div>
            )}
          </div>
          <div className="space-y-1">
            <label className="inline-block cursor-pointer rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-hover)]">
              Upload Photo
              <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} aria-label="Upload profile photo" />
            </label>
            <p className="text-[10px] text-[var(--color-text-muted)]">PNG, JPG, WEBP. Max 2MB.</p>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="Account Information" description="Your name and email are stored on your canonical ERP user account.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase text-[var(--color-text-secondary)]">Display Name</label>
            <input
              type="text"
              value={form.displayName}
              onChange={(e) => patchForm({ displayName: e.target.value })}
              className="h-9 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
              placeholder="Your name"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase text-[var(--color-text-secondary)]">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => patchForm({ email: e.target.value })}
              className="h-9 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
              placeholder="email@example.com"
            />
            <p className="text-[10px] text-[var(--color-text-muted)]">Changing email requires reauthentication and updates Firebase Auth plus the canonical ERP user record.</p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase text-[var(--color-text-secondary)]">Phone</label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => patchForm({ phone: e.target.value })}
              className="h-9 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
              placeholder="+91 9876543210"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase text-[var(--color-text-secondary)]">Signature</label>
            <div className="flex items-center gap-2">
              {signaturePreview ? (
                <img src={signaturePreview} alt="Signature" className="h-9 rounded border border-[var(--color-border)] bg-white px-2 object-contain" />
              ) : null}
              <label className="cursor-pointer rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-hover)]">
                Upload
                <input type="file" accept="image/*" className="hidden" onChange={handleSignatureUpload} aria-label="Upload signature image" />
              </label>
            </div>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="Password" description="Use your current password to securely update your Firebase Authentication credential.">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-[var(--color-text-secondary)]">••••••••</span>
            <button
              onClick={() => setShowPwdModal(true)}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-hover)]"
            >
              Change Password
            </button>
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">Password changes remain on the Firebase Auth account.</p>
        </div>
      </SettingsCard>

      <SettingsCard title="Security & Recovery" className="hidden">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setShowResetModal(true)}>Reset Password</Button>
          <Button variant="outline" onClick={() => { void refresh(); }}>Refresh Profile</Button>
        </div>
      </SettingsCard>

      <Modal open={showPwdModal} onClose={() => setShowPwdModal(false)} title="Change Password" size="sm">
        <form onSubmit={handlePasswordChange} className="space-y-4">
          <Input label="Current Password" type="password" required value={pwdForm.current} onChange={(e) => setPwdForm({ ...pwdForm, current: e.target.value })} />
          <Input label="New Password" type="password" required value={pwdForm.new} onChange={(e) => setPwdForm({ ...pwdForm, new: e.target.value })} />
          {pwdForm.new && pwdForm.new.length < 6 ? (
            <p className="text-[10px] font-medium text-amber-600">Password must be at least 6 characters</p>
          ) : null}
          <Input label="Confirm New Password" type="password" required value={pwdForm.confirm} onChange={(e) => setPwdForm({ ...pwdForm, confirm: e.target.value })} />
          {pwdForm.confirm && pwdForm.new !== pwdForm.confirm ? (
            <p className="text-[10px] font-medium text-red-500">Passwords do not match</p>
          ) : null}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setShowPwdModal(false)}>Cancel</Button>
            <Button type="submit" loading={pwdLoading}>Update Password</Button>
          </div>
        </form>
      </Modal>

      <Modal open={showResetModal} onClose={() => setShowResetModal(false)} title="Reset Password" size="sm">
        {resetSent ? (
          <div className="py-2">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-success-light)] text-[var(--color-success-text)]">
              ✓
            </div>
            <p className="mb-1 text-sm font-semibold text-[var(--color-text)]">Reset Email Sent</p>
            <p className="text-xs text-[var(--color-text-muted)]">If an account exists for <strong>{resetEmail}</strong>, a password reset link has been sent.</p>
            <div className="mt-4">
              <Button variant="outline" size="sm" onClick={() => setShowResetModal(false)}>Close</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <p className="text-xs text-[var(--color-text-muted)]">Enter your email address and we'll send you a link to reset your password.</p>
            <Input label="Email Address" type="email" required value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} />
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowResetModal(false)}>Cancel</Button>
              <Button type="submit" loading={pwdLoading}>Send Reset Link</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={showEmailConfirm} onClose={() => setShowEmailConfirm(false)} title="Confirm Email Change" size="sm">
        <form onSubmit={handleEmailConfirmSubmit} className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">To update your login email, confirm your current password. This will update Firebase Auth and the canonical ERP user record together.</p>
          <Input label="Current Password" type="password" required value={emailPassword} onChange={(e) => setEmailPassword(e.target.value)} />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setShowEmailConfirm(false)}>Cancel</Button>
            <Button type="submit" loading={saveMutation.isPending}>Confirm Change</Button>
          </div>
        </form>
      </Modal>
    </SettingsSection>
  );
}

export default ProfileSection;
