import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NotificationPanelContent } from './NotificationPanel';
import { lockModalScroll, unlockModalScroll } from '../ui/Modal';
import type { Notification } from '../../types';

interface Props {
  open: boolean;
  onClose: () => void;
  notifications: Notification[];
  unreadCount: number;
  isLoading?: boolean;
  error?: string | null;
  onMarkRead: (id: string) => void | Promise<void>;
  onMarkAllRead: () => void | Promise<void>;
}

/**
 * NotificationDrawer — Desktop presentation of the notification system.
 *
 * The notification list, unread/read state, mark-as-read, mark-all-read,
 * loading/empty/error states, row-click navigation and "View all" behavior are
 * ALL the shared NotificationPanelContent / useNotifications implementation —
 * exactly what the working Mobile notification sheet uses. Nothing is
 * duplicated; this component only supplies the right-side drawer chrome
 * (overlay, slide-in/out, close control, scroll lock).
 *
 * Shell relationship (root cause of the old overlap bug):
 *   - The drawer is rendered via createPortal(document.body) because TopBar
 *     sits inside a backdrop-blur header, which would otherwise become the
 *     containing block for position:fixed children and collapse the drawer to
 *     the header's height.
 *   - Because it is portaled to <body>, a naive `fixed inset-0` anchor starts
 *     at the browser viewport top and visually covers the sticky Desktop
 *     Navbar (TopBar, h-14 / 56px). To keep the Navbar fully visible and
 *     untouched, the drawer is anchored at `top: var(--shell-topbar-height)`
 *     (the invariant shell dimension token, 56px) — i.e. it occupies exactly
 *     the application/content region BELOW the Navbar.
 *   - Outside-click dismissal is handled at the drawer level with a single
 *     document pointerdown listener that closes when the target is outside the
 *     panel. This covers every "outside" surface — Navbar, sidebar, homepage
 *     hero, KPIs, tables, blank application areas — without attaching any
 *     click handlers to application content. Clicks inside the panel never
 *     close it (containment check).
 */
export function NotificationDrawer({
  open,
  onClose,
  notifications,
  unreadCount,
  isLoading,
  error,
  onMarkRead,
  onMarkAllRead,
}: Props) {
  const [closing, setClosing] = useState(false);
  const portalElRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  // Initialize outside effects (StrictMode-safe), same as Modal.tsx.
  portalElRef.current ||= document.body;

  // Two-phase close: play the slide-out, then unmount via onAnimationEnd.
  // setClosing(true) is idempotent (React bails out on identical state), so
  // repeated Escape/X/overlay/outside presses cannot double-fire the close.
  const requestClose = useCallback(() => {
    setClosing(true);
  }, []);

  const handleAnimEnd = useCallback(() => {
    if (closing) {
      setClosing(false);
      onClose();
    }
  }, [closing, onClose]);

  // Body scroll lock while open (refcounted — same convention as Modal.tsx).
  useEffect(() => {
    if (!open) return;
    lockModalScroll();
    return () => unlockModalScroll();
  }, [open]);

  // Escape dismisses the drawer (matches the mobile sheet's back-button close).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, requestClose]);

  // Global outside-click dismissal. pointerdown (not click) so it also catches
  // clicks that start a drag/selection outside the panel, and so it fires
  // before the Navbar buttons' click handlers (e.g. toggling the bell closed
  // or opening the user menu) — the drawer closes first, then the button's own
  // handler runs. requestClose is idempotent, so a backdrop click (which also
  // calls requestClose on click) cannot double-fire.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current && !panelRef.current.contains(target)) requestClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, requestClose]);

  if (!open) return null;
  if (!portalElRef.current) return null;

  return createPortal(
    <div
      className="fixed inset-x-0 bottom-0 top-[var(--shell-topbar-height)] z-[100]"
      role="dialog"
      aria-modal="true"
      aria-label="Notifications drawer"
    >
      {/* Overlay — dims only the application content BELOW the Navbar.
          The Navbar (sticky h-14 / var(--shell-topbar-height)) sits entirely
          above this container and stays fully visible and interactive. */}
      <div
        className={`absolute inset-0 bg-black/40 ${closing ? 'animate-modal-backdrop-exit' : 'animate-modal-backdrop-enter'}`}
        onClick={requestClose}
        aria-hidden="true"
      />
      {/* Drawer panel — ~30% viewport width, full application height below the
          Navbar, right-aligned. The slide-in/out animation is unchanged. */}
      <aside
        ref={panelRef}
        onAnimationEnd={handleAnimEnd}
        className={`absolute inset-y-0 right-0 flex w-[30vw] min-w-[22rem] max-w-[30rem] flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl ${closing ? 'animate-drawer-out' : 'animate-drawer-in'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <NotificationPanelContent
          notifications={notifications}
          unreadCount={unreadCount}
          isLoading={isLoading}
          error={error}
          onMarkRead={onMarkRead}
          onMarkAllRead={onMarkAllRead}
          onClose={requestClose}
          fill
          showClose
        />
      </aside>
    </div>,
    portalElRef.current
  );
}

export default NotificationDrawer;
