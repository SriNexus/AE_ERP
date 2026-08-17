import { cn } from '../../utils/cn';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Premium pagination — follows the Universal Table Design System.
 *
 * Features:
 *   - Premium page number buttons with active/hover states
 *   - Previous/Next with ChevronLeft/ChevronRight icons
 *   - Smart ellipsis for large page ranges
 *   - Rows per page selector
 *   - Record count display
 *   - All colors from theme CSS variables
 *   - Keyboard accessible
 *   - Smooth transitions
 */
export function Pagination({
  page,
  total,
  perPage,
  onChange,
  onPerPageChange,
}: {
  page: number;
  total: number;
  perPage: number;
  onChange: (p: number) => void;
  onPerPageChange?: (n: number) => void;
}) {
  const pages = Math.ceil(total / perPage);

  const getPageNums = (): (number | 'ellipsis')[] => {
    if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
    if (page <= 4) return [1, 2, 3, 4, 5, 'ellipsis', pages];
    if (page >= pages - 3) return [1, 'ellipsis', pages - 4, pages - 3, pages - 2, pages - 1, pages];
    return [1, 'ellipsis', page - 1, page, page + 1, 'ellipsis', pages];
  };

  const startRecord = total === 0 ? 0 : (page - 1) * perPage + 1;
  const endRecord = Math.min(page * perPage, total);

  function handlePrev() {
    if (page > 1) onChange(page - 1);
  }

  function handleNext() {
    if (page < pages) onChange(page + 1);
  }

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 px-0 py-0.5 flex-wrap',
        'bg-[var(--color-table-footer-bg)]',
      )}
    >
      {/* Left section: record count + rows per page */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">
          {total === 0
            ? 'No records'
            : `Showing ${startRecord}–${endRecord} of ${total}`}
        </span>
        {onPerPageChange && (
          <select
            value={perPage}
            onChange={(e) => onPerPageChange(Number(e.target.value))}
            aria-label="Rows per page"
            className={cn(
              'h-7 text-xs border rounded-md px-2 py-0.5 outline-none transition-colors',
              'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)]',
              'focus:ring-2 focus:ring-[var(--color-focus-ring)]',
            )}
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Right section: pagination buttons */}
      {pages > 1 && (
        <nav aria-label="Pagination" className="flex items-center gap-1">
          {/* Previous button */}
          <button
            type="button"
            disabled={page <= 1}
            onClick={handlePrev}
            aria-label="Go to previous page"
            className={cn(
              'flex items-center justify-center w-7 h-7 rounded-md border transition-colors duration-100',
              'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)]',
              'hover:bg-[var(--color-pagination-hover)] hover:text-[var(--color-text-secondary)]',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              'focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)]',
            )}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>

          {/* Page number buttons */}
          {getPageNums().map((p, i) =>
            p === 'ellipsis' ? (
              <span
                key={`e${i}`}
                className="flex items-center justify-center w-5 text-xs text-[var(--color-text-muted)] select-none"
                aria-hidden="true"
              >
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onChange(p)}
                aria-current={p === page ? 'page' : undefined}
                aria-label={`Page ${p}`}
                className={cn(
                  'flex items-center justify-center min-w-[28px] h-7 px-1.5 rounded-md border text-xs font-medium transition-all duration-100',
                  p === page
                    ? 'bg-[var(--color-pagination-active)] text-[var(--color-pagination-active-text)] border-[var(--color-pagination-active)] shadow-sm font-semibold'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-pagination-hover)]',
                  'focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)]',
                )}
              >
                {p}
              </button>
            ),
          )}

          {/* Next button */}
          <button
            type="button"
            disabled={page >= pages}
            onClick={handleNext}
            aria-label="Go to next page"
            className={cn(
              'flex items-center justify-center w-7 h-7 rounded-md border transition-colors duration-100',
              'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)]',
              'hover:bg-[var(--color-pagination-hover)] hover:text-[var(--color-text-secondary)]',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              'focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)]',
            )}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </nav>
      )}
    </div>
  );
}
