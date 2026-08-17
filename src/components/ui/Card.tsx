import { cn } from '../../utils/cn';
import React from 'react';

export function Card({children,className,onClick}:{children:React.ReactNode;className?:string;onClick?:()=>void}){
  return(
    <div onClick={onClick}
      style={{
        borderRadius: 'var(--theme-radius)',
        boxShadow: 'var(--theme-card-shadow, var(--theme-shadow-md))',
      }}
      className={cn('bg-[var(--color-surface)] border border-[var(--color-border)]', className)}>
      {children}
    </div>
  );
}
export function CardHeader({children,className}:{children:React.ReactNode;className?:string}){
  return<div className={cn('px-5 py-3.5 border-b border-[var(--color-border-subtle)] flex items-center justify-between gap-3 flex-wrap',className)}>{children}</div>;
}
export function CardTitle({children,className}:{children:React.ReactNode;className?:string}){
  return<h3 className={cn('font-semibold text-[var(--color-text)] text-sm',className)}>{children}</h3>;
}
export function CardBody({children,className}:{children:React.ReactNode;className?:string}){
  return<div className={cn('px-5 py-4',className)}>{children}</div>;
}
export function CardFooter({children,className}:{children:React.ReactNode;className?:string}){
  return(
    <div style={{ borderRadius: '0 0 var(--theme-radius) var(--theme-radius)' }}
      className={cn('px-5 py-3 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] flex items-center gap-3 flex-wrap',className)}>
      {children}
    </div>
  );
}

// SC: semantic icon-color pairs keyed by color name
// These represent intentional palette pigments for icon backgrounds, not theme surfaces
const SC:Record<string,[string,string]>={
  indigo:['bg-[var(--color-primary-light)] text-[var(--color-primary-text)]','ring-[var(--color-primary-muted)]'],
  emerald:['bg-[var(--color-success-light)] text-[var(--color-success-text)]','ring-[var(--color-success)]'],
  amber:['bg-[var(--color-warning-light)] text-[var(--color-warning-text)]','ring-[var(--color-warning)]'],
  red:['bg-[var(--color-danger-light)] text-[var(--color-danger-text)]','ring-[var(--color-danger)]'],
  blue:['bg-[var(--color-info-light)] text-[var(--color-info-text)]','ring-[var(--color-info)]'],
  // accent palette pigments (no semantic token exists for these — VALID to use palette)
  purple:['bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400','ring-purple-200 dark:ring-purple-700'],
  teal:['bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400','ring-teal-200 dark:ring-teal-700'],
  orange:['bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400','ring-orange-200 dark:ring-orange-700'],
  gray:['bg-[var(--color-bg-sunken)] text-[var(--color-text-secondary)]','ring-[var(--color-border)]'],
  pink:['bg-pink-50 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400','ring-pink-200 dark:ring-pink-700'],
};

export function StatCard({label,value,icon,color='indigo',sub,trend,onClick,active}:{label:string;value:string|number;icon:React.ReactNode;color?:string;sub?:string;trend?:{value:number;label?:string};onClick?:()=>void;active?:boolean}){
  const [ic,rc]=SC[color]??SC.indigo;
  return(
    <Card onClick={onClick} className={cn('p-4 flex items-start gap-3.5 transition-all',onClick&&'cursor-pointer hover:-translate-y-0.5',active&&'ring-2 ring-[var(--color-primary)]')}>
      <div className={cn('p-2.5 rounded-xl ring-2 shrink-0',ic,rc)}>{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-[var(--color-text-muted)] font-medium uppercase tracking-wide truncate">{label}</p>
        <p className="text-2xl font-bold text-[var(--color-text)] leading-tight mt-0.5 tabular-nums">{value}</p>
        {sub&&<p className="text-xs text-[var(--color-text-muted)] mt-0.5">{sub}</p>}
        {trend&&<p className={cn('text-xs font-semibold mt-1',trend.value>=0?'text-[var(--color-success-text)]':'text-[var(--color-danger-text)]')}>{trend.value>=0?'↑':'↓'} {Math.abs(trend.value)}% {trend.label??'vs last month'}</p>}
      </div>
    </Card>
  );
}

export function PageHeader({title,subtitle,icon,actions,breadcrumbs,className}:{title:string;subtitle?:string;icon?:React.ReactNode;actions?:React.ReactNode;breadcrumbs?:string[];className?:string}){
  return(
    <div className={cn('flex items-center justify-between gap-4 flex-wrap mb-5',className)}>
      <div className="flex items-center gap-3">
        {icon&&<div className="p-2.5 rounded-xl bg-[var(--color-primary-light)] text-[var(--color-primary-text)] shrink-0">{icon}</div>}
        <div>
          {breadcrumbs&&<p className="text-xs text-[var(--color-text-muted)] mb-0.5">{breadcrumbs.join(' / ')}</p>}
          <h1 className="text-xl font-bold text-[var(--color-text)] leading-tight">{title}</h1>
          {subtitle&&<p className="text-xs text-[var(--color-text-muted)] mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions&&<div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export function EmptyState({icon,title,description,action}:{icon?:React.ReactNode;title:string;description?:string;action?:React.ReactNode}){
  return(
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {icon&&<div className="text-[var(--color-text-disabled)] mb-4">{icon}</div>}
      <p className="text-[var(--color-text-secondary)] font-semibold text-base">{title}</p>
      {description&&<p className="text-[var(--color-text-muted)] text-sm mt-1 max-w-xs">{description}</p>}
      {action&&<div className="mt-5">{action}</div>}
    </div>
  );
}

export function SectionDivider({label}:{label:string}){
  return(
    <div className="flex items-center gap-3 my-2">
      <div className="flex-1 h-px bg-[var(--color-border-subtle)]"/>
      <span className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">{label}</span>
      <div className="flex-1 h-px bg-[var(--color-border-subtle)]"/>
    </div>
  );
}
