import { useLocation } from 'react-router-dom';
import { Building2, ChevronRight } from 'lucide-react';
import { resolveBreadcrumb } from './breadcrumb.config';

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const { label, section } = resolveBreadcrumb(pathname);

  return (
    <nav
      aria-label="Breadcrumb"
      className="hidden sm:flex items-center gap-1.5 text-sm select-none"
    >
      {/* Root icon — muted, non-interactive, lowest hierarchy */}
      <Building2 className="h-3.5 w-3.5 text-[var(--color-text-muted)] shrink-0" />

      {/* Root label */}
      <span className="text-[var(--color-text-muted)] font-medium">ERP</span>

      {section && (
        <>
          {/* Separator: decorative, below muted — use text-disabled */}
          <ChevronRight className="h-3 w-3 text-[var(--color-text-disabled)] shrink-0" />
          {/* Section label: same hierarchy as root */}
          <span className="text-[var(--color-text-muted)]">{section}</span>
        </>
      )}

      {/* Separator before current page */}
      <ChevronRight className="h-3 w-3 text-[var(--color-text-disabled)] shrink-0" />

      {/* Current page: elevated from muted but still below page H1 */}
      <span className="font-semibold text-[var(--color-text-secondary)]">
        {label}
      </span>
    </nav>
  );
}

export default Breadcrumbs;
