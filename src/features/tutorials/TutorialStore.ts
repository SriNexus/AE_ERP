/**
 * TutorialStore — runtime session state for the interactive tutorial engine.
 *
 * Unlike progress (persisted per user), this store only holds the ACTIVE
 * in-memory session. It is intentionally not persisted: refreshing the page
 * mid-tutorial resumes from the persisted progress entry instead of trying
 * to reconstruct a live overlay.
 */
import { create } from 'zustand';

export interface ActiveTutorial {
  tutorialId: string;
  stepIndex: number;
  /** Where to send the user after the tutorial completes (e.g. the page the
   *  Tutorial Center was opened from). */
  returnTo?: string;
}

interface TutorialRuntimeState {
  active: ActiveTutorial | null;
  /** Start (or resume) a tutorial. `returnTo` is used by the completion screen. */
  start: (tutorialId: string, stepIndex?: number, returnTo?: string) => void;
  goto: (stepIndex: number) => void;
  next: () => void;
  back: () => void;
  exit: () => void;
}

export const useTutorialStore = create<TutorialRuntimeState>((set, get) => ({
  active: null,

  start: (tutorialId, stepIndex = 0, returnTo) => set({ active: { tutorialId, stepIndex, returnTo } }),

  goto: (stepIndex) => {
    const active = get().active;
    if (!active) return;
    set({ active: { ...active, stepIndex: Math.max(0, stepIndex) } });
  },

  next: () => {
    const active = get().active;
    if (!active) return;
    set({ active: { ...active, stepIndex: active.stepIndex + 1 } });
  },

  back: () => {
    const active = get().active;
    if (!active) return;
    set({ active: { ...active, stepIndex: Math.max(0, active.stepIndex - 1) } });
  },

  exit: () => set({ active: null }),
}));
