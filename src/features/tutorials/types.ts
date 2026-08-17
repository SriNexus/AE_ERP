/**
 * types — shared types for the Neozy interactive tutorial system.
 *
 * The tutorial engine is a thin, reusable training layer over the real ERP:
 * every step points at a REAL element (via a stable `data-tour` identifier),
 * a real route, or a real interaction — never a screenshot or mockup.
 *
 * Target convention: a step's `target` is the value of a `data-tour`
 * attribute on the real element, e.g. `target: 'leads-create'` resolves to
 * `[data-tour="leads-create"]`. Stable identifiers survive UI churn that
 * would break positional/nth-child selectors.
 */

export type TutorialCategoryId =
  | 'getting-started'
  | 'sales'
  | 'operations'
  | 'finance'
  | 'hr';

/** What the step asks the learner to do with the real UI. */
export type TutorialStepType =
  /** Explain something — optional target, no interaction required. */
  | 'info'
  /** Spotlight a real element and explain it. */
  | 'highlight'
  /** Require (or watch for) a click on the target — auto-advances on click. */
  | 'click'
  /** Watch for typing in the target (e.g. a search box or form field). */
  | 'input'
  /** Watch for a selection in the target (a <select>). */
  | 'select'
  /** Terminal step — renders the completion screen. */
  | 'complete';

/** Preferred popover placement relative to the spotlighted target. */
export type TutorialPlacement = 'top' | 'bottom' | 'left' | 'right' | 'auto';

export interface TutorialStep {
  id: string;
  type: TutorialStepType;
  /** `data-tour` identifier of the real element to spotlight, e.g. 'leads-create'. */
  target?: string;
  title: string;
  /** Business context — WHAT the control does AND WHY it exists. */
  description: string;
  /**
   * Route that must be active for this step. The engine navigates there
   * automatically and waits for the page to render before resolving the
   * target. A trailing `/:id` is prefix-matched (any record id).
   */
  route?: string;
  placement?: TutorialPlacement;
  /** Placeholder text shown for `input` steps. */
  inputPlaceholder?: string;
  /** Short helper line shown under the description for interactive steps. */
  hint?: string;
}

export interface TutorialDefinition {
  id: string;
  title: string;
  description: string;
  category: TutorialCategoryId;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  /** Approximate time in minutes. */
  estimatedMinutes: number;
  /** Route the tutorial starts on. */
  route: string;
  /** Shown on the completion screen — "You can now…". */
  learnings: string[];
  /** Extra terms so search finds the tutorial ("convert lead", "inventory", …). */
  keywords: string[];
  steps: TutorialStep[];
}

export interface TutorialCategory {
  id: TutorialCategoryId;
  title: string;
  description: string;
}

export const TUTORIAL_CATEGORIES: TutorialCategory[] = [
  { id: 'getting-started', title: 'Getting Started', description: 'Orientation, navigation, search, notifications and profile.' },
  { id: 'sales',           title: 'Sales',           description: 'Leads, customers, quotations and orders.' },
  { id: 'operations',      title: 'Operations',      description: 'Projects, inventory, purchase, vendors and dispatch.' },
  { id: 'finance',         title: 'Finance',         description: 'Payments and reports.' },
  { id: 'hr',              title: 'HR',              description: 'Employees and attendance.' },
];

export function categoryTitle(id: TutorialCategoryId): string {
  return TUTORIAL_CATEGORIES.find((c) => c.id === id)?.title ?? id;
}
