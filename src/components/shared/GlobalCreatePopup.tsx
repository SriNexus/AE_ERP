import { X } from 'lucide-react';
import { QuickActions } from '../dashboard/QuickActions';
import { cn } from '../../utils/cn';
import { Modal } from '../ui';

interface GlobalCreatePopupProps {
  open: boolean;
  onClose: () => void;
  variant?: 'desktop' | 'mobile';
}

export function GlobalCreatePopup({ open, onClose, variant = 'desktop' }: GlobalCreatePopupProps) {
  if (!open) return null;

  if (variant === 'desktop') {
    return (
      <Modal open={open} onClose={onClose} title="Create" size="lg">
        <QuickActions onActionComplete={onClose} createOnSelect />
      </Modal>
    );
  }

  return (
    <div
      className={cn(
        'fixed left-0 right-0 flex items-center justify-center bg-[var(--color-overlay)] p-4',
        'top-[50px] bottom-[64px] z-20',
      )}
      role="dialog"
      aria-modal="true"
      aria-label="Create"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="relative">
          <button
            type="button"
            aria-label="Close create menu"
            onClick={onClose}
            className="absolute right-2 top-2 z-10 rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
          <QuickActions onActionComplete={onClose} createOnSelect />
        </div>
      </div>
    </div>
  );
}

export default GlobalCreatePopup;
