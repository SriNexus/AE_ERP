import { cn } from '../../utils/cn';
import { forwardRef, useRef } from 'react';
import React from 'react';
import { Search, X } from 'lucide-react';

type Base={label?:string;error?:string;hint?:string;required?:boolean};
const FOCUS='focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:border-transparent';
const BASE='w-full border px-3 py-2 text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-enterprise-control)] transition';
const BORDER='border-[var(--color-border)] hover:border-[var(--color-border-strong)]';
const ERR_BORDER='border-[var(--color-danger)] bg-[var(--color-danger-light)]';

export const Input=forwardRef<HTMLInputElement,Base&React.InputHTMLAttributes<HTMLInputElement>>(
  ({label,error,hint,className,required,...props},ref)=>(
    <div className="flex flex-col gap-1">
      {label&&<label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">{label}{required&&<span className="text-[var(--color-danger)] ml-1">*</span>}</label>}
      <input ref={ref} required={required} {...props} style={{ borderRadius: 'var(--theme-radius)' }} className={cn(BASE,FOCUS,error?ERR_BORDER:BORDER,className)}/>
      {error&&<p className="text-xs text-[var(--color-danger)]">{error}</p>}
      {hint&&!error&&<p className="text-xs text-[var(--color-text-muted)]">{hint}</p>}
    </div>
  )
);
Input.displayName='Input';

export const Select=forwardRef<HTMLSelectElement,Base&React.SelectHTMLAttributes<HTMLSelectElement>&{options:{label:string;value:string}[]}>(
  ({label,error,options,className,required,...props},ref)=>(
    <div className="flex flex-col gap-1">
      {label&&<label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">{label}{required&&<span className="text-[var(--color-danger)] ml-1">*</span>}</label>}
      <select ref={ref} required={required} {...props} style={{ borderRadius: 'var(--theme-radius)' }} className={cn('w-full border px-3 py-2 text-sm text-[var(--color-text)] bg-[var(--color-bg-elevated)] appearance-none shadow-[var(--shadow-enterprise-control)] transition',FOCUS,error?'border-[var(--color-danger)]':BORDER,className)}>
        {options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error&&<p className="text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  )
);
Select.displayName='Select';

export function Textarea({label,error,className,required,...props}:Base&React.TextareaHTMLAttributes<HTMLTextAreaElement>){
  return(
    <div className="flex flex-col gap-1">
      {label&&<label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">{label}{required&&<span className="text-[var(--color-danger)] ml-1">*</span>}</label>}
      <textarea rows={3} {...props} style={{ borderRadius: 'var(--theme-radius)' }} className={cn('w-full border px-3 py-2 text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] bg-[var(--color-bg-elevated)] transition resize-y',FOCUS,error?'border-[var(--color-danger)] bg-[var(--color-danger-light)]':BORDER,className)}/>
      {error&&<p className="text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

export function SearchInput({value,onChange,placeholder='Search…',className}:{value:string;onChange:(v:string)=>void;placeholder?:string;className?:string}){
  const inputRef = useRef<HTMLInputElement>(null);
  return(
    <div className={cn('relative',className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-muted)] pointer-events-none"/>
      <input ref={inputRef} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        style={{ borderRadius: 'var(--theme-radius)' }}
        className={cn('w-full pl-9 pr-8 py-2 text-sm border bg-[var(--color-bg-elevated)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] shadow-[var(--shadow-enterprise-control)] transition',FOCUS,BORDER)}/>
      {value&&<button type="button" aria-label="Clear search" onClick={()=>onChange('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] p-0.5 rounded"><X className="h-3.5 w-3.5"/></button>}
    </div>
  );
}

const DATE_OPTS=[{label:'All Time',value:'all'},{label:'Today',value:'today'},{label:'Yesterday',value:'yesterday'},{label:'This Week',value:'this_week'},{label:'This Month',value:'this_month'},{label:'This Year',value:'this_year'},{label:'Custom',value:'custom'}];
const SEL_CLS=cn('text-sm border px-3 py-2 bg-[var(--color-bg-elevated)] text-[var(--color-text)] shadow-[var(--shadow-enterprise-control)]',FOCUS,BORDER);

export function DateRangeFilter({value,onChange,customFrom,customTo,onCustomChange,options}:{value:string;onChange:(v:string)=>void;customFrom?:string;customTo?:string;onCustomChange?:(f:string,t:string)=>void;options?:{label:string;value:string}[]}){
  return(
    <div className="flex items-center gap-2">
      <select value={value} onChange={e=>onChange(e.target.value)} style={{ borderRadius: 'var(--theme-radius)' }} className={SEL_CLS}>
        {(options || DATE_OPTS).map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {value==='custom'&&onCustomChange&&(<>
        <input type="date" value={customFrom||''} onChange={e=>onCustomChange(e.target.value,customTo||'')} style={{ borderRadius: 'var(--theme-radius)' }} className={SEL_CLS}/>
        <span className="text-[var(--color-text-muted)] text-sm">to</span>
        <input type="date" value={customTo||''} onChange={e=>onCustomChange(customFrom||'',e.target.value)} style={{ borderRadius: 'var(--theme-radius)' }} className={SEL_CLS}/>
      </>)}
    </div>
  );
}

export function FormRow({children,cols=2}:{children:React.ReactNode;cols?:number}){
  return<div className={cn('grid gap-4',cols===1?'grid-cols-1':cols===2?'grid-cols-1 sm:grid-cols-2':cols===3?'grid-cols-1 sm:grid-cols-3':'grid-cols-2 sm:grid-cols-4')}>{children}</div>;
}
export function FormSection({title,children,className}:{title?:string;children:React.ReactNode;className?:string}){
  return(
    <div className={cn('space-y-4',className)}>
      {title&&<p className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-widest border-b border-[var(--color-border-subtle)] pb-2">{title}</p>}
      {children}
    </div>
  );
}
