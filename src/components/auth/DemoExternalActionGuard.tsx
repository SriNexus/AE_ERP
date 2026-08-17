import { useEffect } from 'react';
import toast from 'react-hot-toast';
import { useAppStore } from '../../store/useAppStore';
import { isCanonicalDemoIdentity } from '../../lib/demoCapabilityPolicy';

export function isExternalCommunicationHref(href: string): boolean {
  const normalized = href.trim().toLowerCase();
  if (normalized.startsWith('mailto:') || normalized.startsWith('tel:') || normalized.startsWith('sms:')) return true;
  try {
    const url = new URL(href, 'https://local.invalid');
    return ['wa.me', 'api.whatsapp.com', 'web.whatsapp.com'].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function DemoExternalActionGuard() {
  const user = useAppStore((state) => state.user);
  const isDemoIdentity = isCanonicalDemoIdentity(user || undefined);

  useEffect(() => {
    if (!isDemoIdentity) return;
    const blockExternalCommunication = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
      const href = target?.getAttribute('href') || '';
      if (!isExternalCommunicationHref(href)) return;
      event.preventDefault();
      event.stopPropagation();
      toast.error('External communication is disabled for the Demo tenant.');
    };
    document.addEventListener('click', blockExternalCommunication, true);
    return () => document.removeEventListener('click', blockExternalCommunication, true);
  }, [isDemoIdentity]);

  return null;
}