/**
 * tutorials — Neozy interactive training layer.
 *
 * Public surface of the tutorial system:
 *  - TutorialCenter: the tutorial library UI (Settings → About ERP → Tutorials).
 *  - TutorialEngine: the global guided-walkthrough overlay (mounted once in
 *    src/app/providers, renders only while a tutorial is active).
 *  - TUTORIALS + getTutorialById: the data-driven tutorial definitions.
 */
export { TutorialEngine } from './TutorialEngine';
export { TutorialCenter } from './TutorialCenter';
export { TUTORIALS, getTutorialById } from './tutorials';
export { useTutorialStore } from './TutorialStore';
export { useTutorialProgress, progressPercent } from './progress';
export type { TutorialDefinition, TutorialStep, TutorialCategoryId } from './types';
