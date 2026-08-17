import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn';
import React from 'react';
import { Button } from './Button';

const SIZES:Record<string,string>={xs:'max-w-xs',sm:'max-w-sm',md:'max-w-lg',lg:'max-w-2xl',xl:'max-w-4xl','2xl':'max-w-6xl','3xl':'max-w-[94vw] sm:max-w-[85vw]',full:'max-w-[96vw]'};
let modalLockCount = 0;

export function lockModalScroll() {
  modalLockCount += 1;
  if (modalLockCount === 1) {
    document.body.classList.add('modal-open');
    document.querySelector('.app-shell__main')?.classList.add('modal-open');
  }
}

export function unlockModalScroll() {
  modalLockCount = Math.max(0, modalLockCount - 1);
  if (modalLockCount === 0) {
    document.body.classList.remove('modal-open');
    document.querySelector('.app-shell__main')?.classList.remove('modal-open');
  }
}

type AnimState = 'closed' | 'entering' | 'open' | 'exiting';
export function initialModalAnimState(open: boolean): AnimState { return open ? 'entering' : 'closed'; }

export function Modal({open,onClose,title,children,size='md',footer}:{open:boolean;onClose:()=>void;title?:string;children:React.ReactNode;size?:string;footer?:React.ReactNode}){
  const [animState, setAnimState] = useState<AnimState>(() => initialModalAnimState(open));
  const prevOpen = useRef(open);
  const portalElRef = useRef<HTMLElement | null>(null);

  // Initialize portal target as soon as possible — must be done outside StrictMode
  // effects to guarantee node availability before createPortal is called.
  portalElRef.current ||= document.body;

  // Track open transitions — use onAnimationEnd on the panel to drive state,
  // avoiding setTimeout race conditions that cause 'Node cannot be found' errors.
  useEffect(() => {
    if (open && !prevOpen.current) {
      setAnimState('entering');
    } else if (!open && prevOpen.current) {
      setAnimState('exiting');
    }
    prevOpen.current = open;
  }, [open]);

  const handlePanelAnimEnd = useCallback(() => {
    if (animState === 'entering') {
      setAnimState('open');
    } else if (animState === 'exiting') {
      setAnimState('closed');
    }
  }, [animState]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (animState === 'entering' || animState === 'open') {
      document.addEventListener('keydown', h);
      lockModalScroll();
    }
    return () => {
      document.removeEventListener('keydown', h);
      if (animState === 'entering' || animState === 'open') unlockModalScroll();
    };
  }, [animState, onClose]);

  if (animState === 'closed') return null;
  if (!portalElRef.current) return null;

  const entering = animState === 'entering';
  const exiting = animState === 'exiting';

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div
        className={cn(
          'absolute inset-0 bg-[var(--color-overlay)] backdrop-blur-sm',
          entering && 'animate-modal-backdrop-enter',
          exiting && 'animate-modal-backdrop-exit',
          !entering && !exiting && 'opacity-100'
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        onAnimationEnd={handlePanelAnimEnd}
        style={{
          borderRadius: 'var(--theme-radius)',
          boxShadow: 'var(--theme-shadow-lg)',
        }}
        className={cn(
          'relative bg-[var(--color-surface)] w-full max-h-[90vh] flex flex-col border border-[var(--color-border)]',
          SIZES[size]??SIZES.md,
          entering && 'animate-modal-panel-enter',
          exiting && 'animate-modal-panel-exit'
        )}>
        {title&&(
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border-subtle)] shrink-0">
            <h2 className="text-base font-semibold text-[var(--color-text)]">{title}</h2>
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"><X className="h-4 w-4"/></button>
          </div>
        )}
        <div className="overflow-y-auto flex-1 px-6 py-5">{children}</div>
        {footer&&<div style={{ borderRadius: '0 0 var(--theme-radius) var(--theme-radius)' }} className="px-6 py-4 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] shrink-0">{footer}</div>}
      </div>
    </div>,
    portalElRef.current
  );
}

export function ConfirmDialog({open,onClose,onConfirm,title,message,confirmLabel='Delete',danger=true,loading=false}:{open:boolean;onClose:()=>void;onConfirm:()=>void;title?:string;message?:string;confirmLabel?:string;danger?:boolean;loading?:boolean}){
  if(!open)return null;
  return(
    <Modal open={open} onClose={onClose} title={title??'Confirm'} size="sm">
      <p className="text-sm text-[var(--color-text-secondary)]">{message??'Are you sure? This cannot be undone.'}</p>
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button variant={danger?'danger':'primary'} size="sm" loading={loading} onClick={onConfirm}>
          {loading?'Processing…':confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
