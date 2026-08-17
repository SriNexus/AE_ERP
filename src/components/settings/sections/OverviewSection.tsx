/**
 * OverviewSection — Settings dashboard.
 *
 * Professional overview of the ERP settings state.
 * Cards show current status of each major configuration area.
 * No backend functionality — purely UI architecture for Phase 2.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Palette, Bell, Shield, Mail, MessageCircle, MessageSquare,
  HardDrive, Sparkles, Info, Cog, Building2,
} from 'lucide-react';
import { useDefaultCompany } from '../../../features/company/hooks/useDefaultCompany';
import { useCurrentUser } from '../../../store/useAppStore';
import { SettingsSection } from '../SettingsSection';
import { SettingsOverviewCard, type OverviewStatus } from '../SettingsOverviewCard';
import { APP_NAME, APP_DISPLAY_VERSION } from '../../../config/appVersion';

export function OverviewSection() {
  const navigate = useNavigate();
  const { company } = useDefaultCompany();
  const user = useCurrentUser();

  const cards = [
    {
      label: 'Default Company',
      value: company?.name || 'Not configured',
      icon: <Building2 className="h-5 w-5" />,
      status: 'configured' as OverviewStatus,
      onClick: () => navigate('/companies'),
    },
    {
      label: 'Current Theme',
      value: 'Light / Dark / System',
      icon: <Sparkles className="h-5 w-5" />,
      status: 'configured' as OverviewStatus,
    },
    {
      label: 'ERP Theme & UI',
      value: company?.primaryColor ? `${company.primaryColor} / ${company.accentColor}` : 'Not configured',
      icon: <Palette className="h-5 w-5" />,
      isConfigured: !!company?.primaryColor,
      onClick: () => navigate('/settings/overview'),
    },
    {
      label: 'Notifications',
      value: '5 preferences configured (local only)',
      icon: <Bell className="h-5 w-5" />,
      status: 'pending' as OverviewStatus,
    },
    {
      label: 'Security',
      value: `Password auth · ${user?.role || 'No role'}`,
      icon: <Shield className="h-5 w-5" />,
      status: 'info' as OverviewStatus,
    },
    {
      label: 'Email',
      value: 'Gmail compose templates',
      icon: <Mail className="h-5 w-5" />,
      status: 'pending' as OverviewStatus,
    },
    {
      label: 'WhatsApp',
      value: 'Not configured',
      icon: <MessageCircle className="h-5 w-5" />,
      status: 'pending' as OverviewStatus,
    },
    {
      label: 'SMS',
      value: 'Not configured',
      icon: <MessageSquare className="h-5 w-5" />,
      status: 'pending' as OverviewStatus,
    },
    {
      label: 'Backup & Restore',
      value: 'Firebase offline persistence active',
      icon: <HardDrive className="h-5 w-5" />,
      status: 'info' as OverviewStatus,
    },
    {
      label: 'ERP Version',
      value: `${APP_NAME} ${APP_DISPLAY_VERSION}`,
      icon: <Info className="h-5 w-5" />,
      status: 'info' as OverviewStatus,
    },
    {
      label: 'Automation',
      value: 'Settlement scheduler available',
      icon: <Cog className="h-5 w-5" />,
      status: 'pending' as OverviewStatus,
    },
  ];

  return (
    <SettingsSection
      title="Overview"
      description="ERP system status at a glance"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.map((card) => (
          <SettingsOverviewCard
            key={card.label}
            label={card.label}
            value={card.value}
            icon={card.icon}
            status={card.status}
            isConfigured={card.isConfigured}
            onClick={card.onClick}
          />
        ))}
      </div>
    </SettingsSection>
  );
}
