/**
 * TutorialCenter — the interactive tutorial library.
 *
 * Opened from Settings → About ERP → Tutorials (and from the "Learn this
 * workspace" entry point on module pages). Lists every tutorial definition
 * grouped by category, with search and per-user progress state
 * (Not started / x% / Completed → Start / Resume / Replay).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Search, X, Play, RotateCcw, Clock, GraduationCap, Rocket,
  ClipboardList, Truck, Wallet, Users, CheckCircle2, BookOpen,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { cn } from '../../utils/cn';
import { useCurrentUser } from '../../store/useAppStore';
import { TUTORIALS } from './tutorials';
import { useTutorialStore } from './TutorialStore';
import { useTutorialProgress, progressPercent } from './progress';
import { TUTORIAL_CATEGORIES, categoryTitle, type TutorialCategoryId, type TutorialDefinition } from './types';

const CATEGORY_ICONS: Record<TutorialCategoryId, React.ComponentType<{ className?: string }>> = {
  'getting-started': Rocket,
  'sales': ClipboardList,
  'operations': Truck,
  'finance': Wallet,
  'hr': Users,
};

export function TutorialCenter({
  open,
  onClose,
  initialCategory,
}: {
  open: boolean;
  onClose: () => void;
  /** Open the library pre-filtered to one category (e.g. 'sales' from Leads). */
  initialCategory?: TutorialCategoryId;
}) {
  const user = useCurrentUser();
  const { start } = useTutorialStore();
  const resetProgress = useTutorialProgress((s) => s.reset);
  const progressMap = useTutorialProgress((s) => s.map);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<TutorialCategoryId | null>(initialCategory ?? null);

  // Pre-filtered entry point (e.g. "Learn this workspace" inside Leads).
  useEffect(() => {
    if (open) setCategory(initialCategory ?? null);
  }, [open, initialCategory]);

  const userProgress = useMemo(() => (user?.id ? progressMap[user.id] ?? {} : {}), [progressMap, user?.id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TUTORIALS.filter((t) => {
      if (category && t.category !== category) return false;
      if (!q) return true;
      const hay = `${t.title} ${t.description} ${t.keywords.join(' ')} ${categoryTitle(t.category)}`.toLowerCase();
      return hay.includes(q);
    });
  }, [query, category]);

  function handleStart(t: TutorialDefinition) {
    const entry = userProgress[t.id];
    const resumeAt = entry?.status === 'in-progress' ? Math.min(entry.lastStep, t.steps.length - 1) : 0;
    // Replay starts the tutorial cleanly again (matches the completion
    // screen's own Replay behaviour), so progress reflects the new run.
    if (entry?.status === 'completed') resetProgress(user?.id ?? '', t.id);
    start(t.id, resumeAt, window.location.pathname);
    onClose();
  }

  const categorized = TUTORIAL_CATEGORIES.map((c) => ({
    ...c,
    tutorials: filtered.filter((t) => t.category === c.id),
  })).filter((c) => !query.trim() || c.tutorials.length > 0);

  return (
    <Modal open={open} onClose={onClose} size="3xl" title="Interactive Tutorials">
      <div className="flex flex-col gap-4 min-h-[60vh] max-h-[75vh]">
        {/* ── Intro + search ── */}
        <div className="rounded-xl border border-[var(--color-primary-muted)] bg-[var(--color-primary-light)] px-4 py-3">
          <p className="text-[13px] leading-relaxed text-[var(--color-primary-text)]">
            Learn how to actually use Neozy — pick a tutorial, press Start, and follow the highlighted controls
            on the <span className="font-semibold">real screens</span>. Your progress is saved automatically so you can
            resume any time.
          </p>
        </div>

        <div className="relative shrink-0">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tutorials — e.g. “convert lead”, “create lead”, “filter”"
            aria-label="Search tutorials"
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] py-2 pl-9 pr-8 text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* ── Category chips ── */}
        <div className="flex flex-wrap gap-1.5 shrink-0">
          <Chip active={!category} onClick={() => setCategory(null)}>All</Chip>
          {TUTORIAL_CATEGORIES.map((c) => {
            const Icon = CATEGORY_ICONS[c.id];
            const count = TUTORIALS.filter((t) => t.category === c.id).length;
            return (
              <Chip key={c.id} active={category === c.id} onClick={() => setCategory(category === c.id ? null : c.id)}>
                <Icon className="h-3.5 w-3.5" />
                {c.title}
                <span className="ml-0.5 text-[10px] opacity-60">{count || ''}</span>
              </Chip>
            );
          })}
        </div>

        {/* ── Tutorial list ── */}
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {categorized.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Search className="h-8 w-8 text-[var(--color-text-disabled)]" />
              <p className="mt-3 text-sm font-semibold text-[var(--color-text)]">No tutorials match “{query}”</p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">Try a different term, or clear the search.</p>
            </div>
          )}

          {categorized.map((c) => {
            const Icon = CATEGORY_ICONS[c.id];
            return (
              <div key={c.id} className="mb-5">
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--color-primary-light)] text-[var(--color-primary-text)]">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text)]">{c.title}</h3>
                  <p className="hidden text-[11px] text-[var(--color-text-muted)] sm:block">{c.description}</p>
                </div>

                {c.tutorials.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-[var(--color-border)] px-3 py-2.5 text-xs text-[var(--color-text-muted)]">
                    Tutorials for this category are coming soon.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {c.tutorials.map((t) => {
                      const entry = userProgress[t.id];
                      const pct = progressPercent(entry);
                      const completed = entry?.status === 'completed';
                      const inProgress = entry?.status === 'in-progress';
                      return (
                        <div
                          key={t.id}
                          className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-colors hover:border-[var(--color-border-strong)]"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-[var(--color-text)]">{t.title}</p>
                              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--color-text-muted)]">
                                <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{t.estimatedMinutes} min</span>
                                <span>·</span>
                                <span>{t.difficulty}</span>
                                <span>·</span>
                                <span className="inline-flex items-center gap-1"><BookOpen className="h-3 w-3" />{t.steps.length} steps</span>
                              </div>
                            </div>
                            <StatusChip completed={completed} inProgress={inProgress} pct={pct} />
                          </div>

                          <p className="line-clamp-2 text-xs leading-relaxed text-[var(--color-text-secondary)]">{t.description}</p>

                          {inProgress && (
                            <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--color-bg-sunken)]">
                              <div className="h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${pct}%` }} />
                            </div>
                          )}

                          <div className="flex items-center gap-2 pt-0.5">
                            <Button
                              size="sm"
                              className="flex-1"
                              icon={completed ? <RotateCcw className="h-3.5 w-3.5" /> : inProgress ? <Play className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                              onClick={() => handleStart(t)}
                            >
                              {completed ? 'Replay' : inProgress ? 'Resume' : 'Start Tutorial'}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

function Chip({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
        active
          ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary-text)]'
          : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]',
      )}
    >
      {children}
    </button>
  );
}

function StatusChip({ completed, inProgress, pct }: { completed: boolean; inProgress: boolean; pct: number }) {
  if (completed) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-success-light)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-success-text)]">
        <CheckCircle2 className="h-3 w-3" /> Completed
      </span>
    );
  }
  if (inProgress) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-warning-light)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-warning-text)]">
        ◐ {pct}%
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-bg-sunken)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-text-muted)]">
      <GraduationCap className="h-3 w-3" /> Not started
    </span>
  );
}

export default TutorialCenter;
