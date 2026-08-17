import { cn } from '../../utils/cn';
import { Loader2 } from 'lucide-react';
import React from 'react';

type Variant='primary'|'secondary'|'danger'|'ghost'|'outline'|'success'|'warning';
type Size='xs'|'sm'|'md'|'lg';

const V:Record<Variant,string>={
  primary:  'bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-[var(--color-text-inverse)]',
  secondary:'bg-[var(--color-bg-sunken)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] border border-[var(--color-border)]',
  danger:   'bg-[var(--color-danger)] hover:opacity-90 text-[var(--color-text-inverse)]',
  ghost:    'hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]',
  outline:  'border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] bg-[var(--color-surface)]',
  success:  'bg-[var(--color-success)] hover:opacity-90 text-[var(--color-text-inverse)]',
  warning:  'bg-[var(--color-warning)] hover:opacity-90 text-[var(--color-text-inverse)]',
};
const S:Record<Size,string>={
  xs:'px-2 py-1 text-xs gap-1 min-h-11 md:min-h-0 md:h-6',
  sm:'px-3 py-1.5 text-xs gap-1.5 min-h-11 md:min-h-0 md:h-7',
  md:'px-4 py-2 text-sm gap-2 min-h-11 md:min-h-0 md:h-9',
  lg:'px-5 py-2.5 text-sm gap-2 min-h-11 md:min-h-0 md:h-10',
};

const FOCUS='focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1';

type Props={variant?:Variant;size?:Size;loading?:boolean;icon?:React.ReactNode}&React.ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({children,variant='primary',size='md',loading=false,icon,className,...props}:Props) {
  return (
    <button {...props} disabled={loading||props.disabled}
      style={{ borderRadius: 'var(--theme-radius)', boxShadow: ['primary','danger','success','warning'].includes(variant) ? 'var(--theme-shadow-md)' : 'none' }}
      className={cn('inline-flex items-center justify-center font-medium transition-all select-none disabled:opacity-50 disabled:cursor-not-allowed',FOCUS,V[variant],S[size],className)}>
      {loading?<Loader2 className="animate-spin h-3.5 w-3.5 shrink-0"/>:icon}
      {children}
    </button>
  );
}

type IBProps={icon:React.ReactNode;title?:string;onClick?:()=>void;variant?:Variant;size?:Size;className?:string;disabled?:boolean};
export function IconButton({icon,title,onClick,variant='ghost',size='md',className,disabled}:IBProps) {
  const p=size==='xs'?'p-1 min-h-11 min-w-11 md:min-h-0 md:min-w-0':size==='sm'?'p-1.5 min-h-11 min-w-11 md:min-h-0 md:min-w-0':'p-2 min-h-11 min-w-11 md:min-h-0 md:min-w-0';
  return (
    <button onClick={onClick} title={title} aria-label={title} disabled={disabled}
      style={{ borderRadius: 'var(--theme-radius)' }}
      className={cn('inline-flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed',FOCUS,V[variant],p,className)}>
      {icon}
    </button>
  );
}
