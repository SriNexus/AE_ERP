/**
 * UserGuide — interactive in-product User Guide, opened from
 * Settings → About ERP. Real navigation only: every "Open X" button
 * resolves to an actual route (src/app/router/routes.tsx) and is gated
 * through the SAME usePermissions().canView() check RoleRoute itself uses —
 * the guide can explain a module the current user can't access, but it will
 * never send them into a route their own role would be redirected away
 * from.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, ChevronDown, ChevronRight, ArrowLeft, Lock, Sparkles,
  ListChecks, Users2, Rocket, X,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { cn } from '../../utils/cn';
import { usePermissions } from '../../lib/permissions';
import { GUIDE_SECTIONS, COMMON_TASKS, ROLE_GUIDES, type GuideLink, type GuideTopic, type CommonTask } from './guideContent';

type View = 'home' | 'section' | 'tasks' | 'roles';

function GuideActionLink({ link, onNavigate }: { link: GuideLink; onNavigate: (path: string) => void }) {
  const perms = usePermissions();
  const allowed = perms.ready && perms.canView(link.module);
  if (!perms.ready) {
    return <Button size="sm" variant="outline" disabled>{link.label}</Button>;
  }
  if (!allowed) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-text-muted)]">
        <Lock className="h-3 w-3 shrink-0" /> Restricted for your role — ask your Administrator
      </span>
    );
  }
  return (
    <Button size="sm" onClick={() => onNavigate(link.path)}>
      {link.label}
    </Button>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-0.5 text-[13px] leading-snug text-[var(--color-text-secondary)]">{value}</p>
    </div>
  );
}

function TopicCard({ topic, expanded, onToggle, onNavigate }: {
  topic: GuideTopic; expanded: boolean; onToggle: () => void; onNavigate: (path: string) => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-[var(--color-surface-hover)] transition-colors"
      >
        <span className="text-sm font-bold text-[var(--color-text)]">{topic.title}</span>
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" /> : <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />}
      </button>
      {expanded && (
        <div className="border-t border-[var(--color-border-subtle)] px-4 py-3 space-y-3">
          <Field label="What is it?" value={topic.what} />
          <Field label="Why we use it" value={topic.why} />
          <Field label="When to use it" value={topic.when} />
          <Field label="What you'll need" value={topic.info} />
          {topic.actions && topic.actions.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">What you can do here</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {topic.actions.map((a) => (
                  <li key={a} className="rounded-full bg-[var(--color-bg-sunken)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]">{a}</li>
                ))}
              </ul>
            </div>
          )}
          <Field label="After you save" value={topic.after} />
          <Field label="Where it goes next" value={topic.next} />
          {topic.links.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {topic.links.map((l) => <GuideActionLink key={l.path} link={l} onNavigate={onNavigate} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TaskCard({ task, expanded, onToggle, onNavigate }: {
  task: CommonTask; expanded: boolean; onToggle: () => void; onNavigate: (path: string) => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-[var(--color-surface-hover)] transition-colors"
      >
        <span className="text-sm font-bold text-[var(--color-text)]">{task.question}</span>
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" /> : <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />}
      </button>
      {expanded && (
        <div className="border-t border-[var(--color-border-subtle)] px-4 py-3 space-y-3">
          <Field label="Purpose" value={task.purpose} />
          <Field label="When" value={task.when} />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">Steps</p>
            <ol className="space-y-1">
              {task.steps.map((s, i) => (
                <li key={i} className="flex gap-2 text-[13px] text-[var(--color-text-secondary)]">
                  <span className="shrink-0 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-primary-light)] text-[10px] font-bold text-[var(--color-primary-text)] mt-0.5">{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
          </div>
          <Field label="Next step" value={task.next} />
          {task.link && (
            <div className="pt-1">
              <GuideActionLink link={task.link} onNavigate={onNavigate} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function UserGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [view, setView] = useState<View>('home');
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleNavigate(path: string) {
    onClose();
    navigate(path);
  }

  function goHome() {
    setView('home'); setActiveSectionId(null); setQuery('');
  }

  function openSection(id: string) {
    setActiveSectionId(id); setView('section'); setQuery(''); setExpanded(new Set());
  }

  const activeSection = useMemo(() => GUIDE_SECTIONS.find((s) => s.id === activeSectionId) || null, [activeSectionId]);
  const isSearching = query.trim().length > 0;

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const topics: Array<{ sectionId: string; sectionTitle: string; topic: GuideTopic }> = [];
    for (const section of GUIDE_SECTIONS) {
      for (const topic of section.topics) {
        // Include the parent section's own title/intro in the haystack — a
        // topic's own text doesn't always repeat the group name a user would
        // naturally search for (e.g. "inventory" matches the Inventory
        // section by name, even though none of its topics — Products,
        // Warehouses, Stock, Dispatch — happen to use that exact word).
        const hay = `${section.title} ${section.intro} ${topic.title} ${topic.what} ${topic.why || ''} ${topic.when || ''}`.toLowerCase();
        if (hay.includes(q)) topics.push({ sectionId: section.id, sectionTitle: section.title, topic });
      }
    }
    const tasks = COMMON_TASKS.filter((t) => `${t.question} ${t.purpose}`.toLowerCase().includes(q));
    return { topics, tasks };
  }, [query]);

  return (
    <Modal open={open} onClose={onClose} size="3xl" title="Neozy ERP — User Guide">
      <div className="flex flex-col md:flex-row gap-4 min-h-[60vh] max-h-[75vh]">
        {/* ── Nav rail (desktop) / top bar (mobile) ── */}
        <div className="md:w-56 shrink-0 flex md:flex-col gap-1 overflow-x-auto md:overflow-x-visible md:overflow-y-auto pb-2 md:pb-0 border-b md:border-b-0 md:border-r border-[var(--color-border-subtle)] md:pr-3">
          <button
            type="button"
            onClick={goHome}
            className={cn('shrink-0 flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors whitespace-nowrap',
              !isSearching && view === 'home' ? 'bg-[var(--color-primary-light)] text-[var(--color-primary-text)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]')}
          >
            <Rocket className="h-4 w-4" /> Start Here
          </button>
          {GUIDE_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => openSection(s.id)}
              className={cn('shrink-0 flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors whitespace-nowrap',
                !isSearching && view === 'section' && activeSectionId === s.id ? 'bg-[var(--color-primary-light)] text-[var(--color-primary-text)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]')}
            >
              {s.title}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { setView('tasks'); setQuery(''); setExpanded(new Set()); }}
            className={cn('shrink-0 flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors whitespace-nowrap',
              !isSearching && view === 'tasks' ? 'bg-[var(--color-primary-light)] text-[var(--color-primary-text)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]')}
          >
            <ListChecks className="h-4 w-4" /> Common Tasks
          </button>
          <button
            type="button"
            onClick={() => { setView('roles'); setQuery(''); setExpanded(new Set()); }}
            className={cn('shrink-0 flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors whitespace-nowrap',
              !isSearching && view === 'roles' ? 'bg-[var(--color-primary-light)] text-[var(--color-primary-text)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]')}
          >
            <Users2 className="h-4 w-4" /> Roles in Neozy
          </button>
        </div>

        {/* ── Content ── */}
        <div className="flex-1 min-w-0 flex flex-col gap-3 overflow-hidden">
          {/* Search */}
          <div className="relative shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-muted)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the guide — e.g. “create customer”, “inventory”, “payment”"
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] pl-9 pr-8 py-2 text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
            {query.trim() ? (
              <>
                {searchResults && searchResults.topics.length === 0 && searchResults.tasks.length === 0 && (
                  <p className="text-sm text-[var(--color-text-muted)] py-8 text-center">No matches for “{query}”. Try a different term.</p>
                )}
                {searchResults && searchResults.topics.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1.5">Modules</p>
                    <div className="space-y-2">
                      {searchResults.topics.map(({ topic, sectionTitle }) => (
                        <div key={topic.id}>
                          <p className="text-[10px] text-[var(--color-text-muted)] mb-1">{sectionTitle}</p>
                          <TopicCard topic={topic} expanded={expanded.has(topic.id)} onToggle={() => toggle(topic.id)} onNavigate={handleNavigate} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {searchResults && searchResults.tasks.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1.5">Common Tasks</p>
                    <div className="space-y-2">
                      {searchResults.tasks.map((t) => (
                        <TaskCard key={t.id} task={t} expanded={expanded.has(t.id)} onToggle={() => toggle(t.id)} onNavigate={handleNavigate} />
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : view === 'home' ? (
              <HomeView onOpenTasks={() => setView('tasks')} onOpenSection={openSection} />
            ) : view === 'tasks' ? (
              <div className="space-y-2">
                <p className="text-xs text-[var(--color-text-muted)]">Practical, step-by-step answers to things you’ll do every day.</p>
                {COMMON_TASKS.map((t) => (
                  <TaskCard key={t.id} task={t} expanded={expanded.has(t.id)} onToggle={() => toggle(t.id)} onNavigate={handleNavigate} />
                ))}
              </div>
            ) : view === 'roles' ? (
              <div className="space-y-2">
                <p className="text-xs text-[var(--color-text-muted)]">Different roles see different parts of Neozy. This is why you may not see every page mentioned in this guide — that’s expected, not a bug.</p>
                {ROLE_GUIDES.map((r) => (
                  <div key={r.role} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                    <p className="text-sm font-bold text-[var(--color-text)]">{r.role}</p>
                    <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">{r.summary}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {r.focusAreas.map((f) => (
                        <span key={f} className="rounded-full bg-[var(--color-bg-sunken)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]">{f}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : activeSection ? (
              <div className="space-y-2">
                <button type="button" onClick={goHome} className="md:hidden inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] mb-1">
                  <ArrowLeft className="h-3.5 w-3.5" /> Start Here
                </button>
                <p className="text-xs text-[var(--color-text-muted)]">{activeSection.intro}</p>
                {activeSection.topics.map((t) => (
                  <TopicCard key={t.id} topic={t} expanded={expanded.has(t.id)} onToggle={() => toggle(t.id)} onNavigate={handleNavigate} />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function HomeView({ onOpenTasks, onOpenSection }: { onOpenTasks: () => void; onOpenSection: (id: string) => void }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--color-primary-muted)] bg-[var(--color-primary-light)] p-5">
        <div className="flex items-center gap-2 text-[var(--color-primary-text)]">
          <Sparkles className="h-5 w-5" />
          <h3 className="text-base font-bold">Welcome to Neozy</h3>
        </div>
        <p className="mt-2 text-sm text-[var(--color-primary-text)]">
          Neozy helps your team manage the complete Solar EPC business — from the first customer enquiry through
          design, procurement, installation, and after-sales service — in one connected system.
        </p>
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h3 className="text-sm font-bold text-[var(--color-text)] mb-3">New to Neozy? Start with these</h3>
        <ol className="space-y-2.5">
          {[
            'Understand your role — check "Roles in Neozy" to see which modules are yours.',
            'Learn the core workflow — Lead → Customer → Project → Survey → Engineering → Quotation → Order → Payment → Installation → Commissioning.',
            'Find the pages you\'ll use daily from the left menu here, grouped the same way as the sidebar.',
            'Learn how to create records using "Common Tasks" — step-by-step, with a direct link to the right page.',
            'Learn how records connect — each module below explains what feeds into it and what it feeds into next.',
            'Check Notifications regularly, and use Reports for a wider view of how things are going.',
            'If a page or button is missing, it\'s usually your role\'s permissions — see "Roles in Neozy", or ask your Administrator.',
          ].map((step, i) => (
            <li key={i} className="flex gap-2.5 text-sm text-[var(--color-text-secondary)]">
              <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-primary)] text-[11px] font-bold text-white mt-0.5">{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
        <div className="mt-4">
          <Button size="sm" icon={<ListChecks className="h-3.5 w-3.5" />} onClick={onOpenTasks}>See Common Tasks</Button>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h3 className="text-sm font-bold text-[var(--color-text)] mb-1">The Neozy workflow, in order</h3>
        <p className="text-xs text-[var(--color-text-muted)] mb-3">
          Not every project uses every stage — for example, a materials-only (B2B) sale skips the on-site installation stages.
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {['Lead', 'Customer', 'Project', 'Survey', 'Engineering', 'Quotation', 'Order', 'Payment', 'Procurement', 'Installation', 'Commissioning', 'Handover'].map((stage, i, arr) => (
            <span key={stage} className="flex items-center gap-1.5">
              <span className="rounded-full bg-[var(--color-bg-sunken)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-text-secondary)]">{stage}</span>
              {i < arr.length - 1 && <ChevronRight className="h-3 w-3 text-[var(--color-text-disabled)]" />}
            </span>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold text-[var(--color-text)] mb-2">Browse by area</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {[
            ['sales', 'Sales'], ['field-ops', 'Field Operations'], ['procurement', 'Procurement'],
            ['inventory', 'Inventory'], ['compliance', 'Compliance'], ['post-sale', 'Post-Sale'],
            ['partners', 'Channel Partners'], ['hr', 'HR'], ['finance', 'Finance'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => onOpenSection(id)}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-left text-xs font-semibold text-[var(--color-text-secondary)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary-text)] transition-colors"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default UserGuide;
