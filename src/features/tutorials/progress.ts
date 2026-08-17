/**
 * progress — per-user tutorial progress tracking.
 *
 * Persisted in localStorage (no backend needed for the current requirement):
 *   key   → neozy-tutorial-progress-v1
 *   value → { [userId]: { [tutorialId]: TutorialProgressEntry } }
 *
 * Keyed by user id so each employee keeps their own completed/resumed state
 * on the device they use. The engine and the Tutorial Center share this
 * store, so a resumed tutorial picks up exactly where it stopped.
 */
import { create } from 'zustand';

export type TutorialStatus = 'not-started' | 'in-progress' | 'completed';

export interface TutorialProgressEntry {
  status: TutorialStatus;
  /** Furthest step index reached (0-based). */
  lastStep: number;
  totalSteps: number;
  startedAt?: number;
  completedAt?: number;
  /** How many times the tutorial has been completed. */
  completions: number;
}

type UserProgressMap = Record<string, Record<string, TutorialProgressEntry>>;

const STORAGE_KEY = 'neozy-tutorial-progress-v1';

function load(): UserProgressMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function persist(map: UserProgressMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage unavailable (private mode / quota) — progress is session-only.
  }
}

interface ProgressState {
  map: UserProgressMap;
  recordStep: (userId: string, tutorialId: string, stepIndex: number, totalSteps: number) => void;
  complete: (userId: string, tutorialId: string, totalSteps: number) => void;
  reset: (userId: string, tutorialId: string) => void;
}

export const useTutorialProgress = create<ProgressState>((set) => ({
  map: load(),

  recordStep: (userId, tutorialId, stepIndex, totalSteps) =>
    set((state) => {
      if (!userId) return state;
      const userMap = state.map[userId] ?? {};
      const current = userMap[tutorialId];
      // A completed tutorial stays completed until replayed.
      const next: TutorialProgressEntry = {
        status: current?.status === 'completed' ? 'completed' : 'in-progress',
        lastStep: Math.max(current?.lastStep ?? 0, stepIndex),
        totalSteps,
        startedAt: current?.startedAt ?? Date.now(),
        completedAt: current?.completedAt,
        completions: current?.completions ?? 0,
      };
      const nextMap = { ...state.map, [userId]: { ...userMap, [tutorialId]: next } };
      persist(nextMap);
      return { map: nextMap };
    }),

  complete: (userId, tutorialId, totalSteps) =>
    set((state) => {
      if (!userId) return state;
      const userMap = state.map[userId] ?? {};
      const current = userMap[tutorialId];
      const next: TutorialProgressEntry = {
        status: 'completed',
        lastStep: totalSteps - 1,
        totalSteps,
        startedAt: current?.startedAt ?? Date.now(),
        completedAt: Date.now(),
        completions: (current?.completions ?? 0) + 1,
      };
      const nextMap = { ...state.map, [userId]: { ...userMap, [tutorialId]: next } };
      persist(nextMap);
      return { map: nextMap };
    }),

  reset: (userId, tutorialId) =>
    set((state) => {
      if (!userId || !state.map[userId]) return state;
      const userMap = { ...state.map[userId] };
      delete userMap[tutorialId];
      const nextMap = { ...state.map, [userId]: userMap };
      persist(nextMap);
      return { map: nextMap };
    }),
}));

/** Read a user's progress entry for one tutorial (reactive via the store). */
export function getTutorialProgress(userId: string, tutorialId: string): TutorialProgressEntry | undefined {
  return useTutorialProgress.getState().map[userId]?.[tutorialId];
}

export function progressPercent(entry: TutorialProgressEntry | undefined): number {
  if (!entry || entry.totalSteps <= 0) return 0;
  if (entry.status === 'completed') return 100;
  return Math.min(100, Math.round(((entry.lastStep + 1) / entry.totalSteps) * 100));
}
