/**
 * UsersPermissionsSection — Navigation cards to existing Users and Roles pages.
 *
 * No CRUD inside Settings. Users and Roles have their own dedicated pages.
 * This section provides quick navigation links.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Shield } from 'lucide-react';
import { SettingsSection } from '../SettingsSection';
import { Card, CardHeader, CardTitle, CardBody } from '../../ui/Card';

export function UsersPermissionsSection() {
  const navigate = useNavigate();

  return (
    <SettingsSection
      title="Users & Permissions"
      description="Manage users, roles and access control"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => navigate('/users')}
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-left transition-all duration-150 hover:shadow-md hover:-translate-y-0.5 group"
        >
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center group-hover:scale-105 transition-transform">
              <Users className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--color-text)]">Users</h3>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                Add, edit, and manage ERP user accounts
              </p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
            Open Users
            <span className="group-hover:translate-x-0.5 transition-transform">→</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => navigate('/roles')}
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-left transition-all duration-150 hover:shadow-md hover:-translate-y-0.5 group"
        >
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-purple-50 dark:bg-purple-900/30 flex items-center justify-center group-hover:scale-105 transition-transform">
              <Shield className="h-6 w-6 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--color-text)]">Roles</h3>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                Define roles, permissions and access levels
              </p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1 text-xs font-semibold text-purple-600 dark:text-purple-400">
            Open Roles
            <span className="group-hover:translate-x-0.5 transition-transform">→</span>
          </div>
        </button>
      </div>
    </SettingsSection>
  );
}
