/**
 * OfflineBanner — Mobile offline/connectivity indicator
 *
 * Shows a banner at the top of the screen when the browser goes offline,
 * and auto-hides when connectivity is restored.
 *
 * Integrates with React Query's network status to show cached data availability.
 * No duplicated logic — uses standard browser `online`/`offline` events.
 */

import { useState, useEffect, useCallback } from 'react';
import { cn } from '../../../utils/cn';
import { Wifi, WifiOff, RefreshCw } from 'lucide-react';

export function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showBanner, setShowBanner] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const handleOnline = useCallback(() => {
    setIsOnline(true);
    // Show "back online" briefly before hiding
    setShowBanner(true);
    const timer = setTimeout(() => {
      setShowBanner(false);
      setDismissed(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  const handleOffline = useCallback(() => {
    setIsOnline(false);
    setShowBanner(true);
    setDismissed(false);
  }, []);

  useEffect(() => {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [handleOnline, handleOffline]);

  // Check periodically (every 30s) as well
  useEffect(() => {
    const interval = setInterval(() => {
      const online = navigator.onLine;
      if (online !== isOnline) {
        setIsOnline(online);
        setShowBanner(true);
        if (online) {
          setTimeout(() => {
            setShowBanner(false);
            setDismissed(false);
          }, 3000);
        }
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [isOnline]);

  if (!showBanner || dismissed) return null;

  return (
    <div
      className={cn(
        'fixed top-0 left-0 right-0 z-[60] px-4 py-2 text-xs font-semibold text-center transition-all duration-300',
        isOnline
          ? 'bg-emerald-500 text-white'
          : 'bg-amber-500 text-white',
      )}
    >
      <div className="flex items-center justify-center gap-2">
        {isOnline ? (
          <>
            <Wifi className="h-3.5 w-3.5" />
            <span>Back online — syncing data</span>
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          </>
        ) : (
          <>
            <WifiOff className="h-3.5 w-3.5" />
            <span>You&apos;re offline — showing cached data</span>
          </>
        )}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="ml-2 rounded px-1.5 py-0.5 text-white/80 hover:text-white hover:bg-white/10"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default OfflineBanner;
