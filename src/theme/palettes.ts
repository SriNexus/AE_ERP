/**
 * Chart Palettes — Centralized palette definitions for ERP charts and graphs.
 *
 * Each palette ID maps to an array of hex colors suitable for chart libraries.
 * Supports 6 palette IDs with graceful fallback to default.
 *
 * Usage:
 *   import { resolvePalette } from 'src/theme/palettes';
 *   const colors = resolvePalette('sales');
 *   // → ['#10b981', '#f59e0b', '#3b82f6', ...]
 */

export type ChartPaletteId = 'default' | 'finance' | 'sales' | 'marketing' | 'inventory' | 'custom';

/** Full palette definition */
export interface ChartPalette {
  id: ChartPaletteId;
  label: string;
  /** Array of hex colors for chart series */
  colors: string[];
}

/** Built-in chart palettes */
export const CHART_PALETTES: ChartPalette[] = [
  {
    id: 'default',
    label: 'Default',
    colors: [
      '#4f46e5', // indigo
      '#10b981', // emerald
      '#f59e0b', // amber
      '#ef4444', // red
      '#8b5cf6', // violet
      '#06b6d4', // cyan
      '#f97316', // orange
      '#ec4899', // pink
      '#14b8a6', // teal
      '#84cc16', // lime
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    colors: [
      '#059669', // emerald dark
      '#0284c7', // sky
      '#d97706', // amber dark
      '#dc2626', // red dark
      '#7c3aed', // violet
      '#0891b2', // cyan dark
      '#ea580c', // orange dark
      '#2563eb', // blue
      '#0d9488', // teal dark
      '#9333ea', // purple
    ],
  },
  {
    id: 'sales',
    label: 'Sales',
    colors: [
      '#10b981', // emerald
      '#f59e0b', // amber
      '#3b82f6', // blue
      '#8b5cf6', // violet
      '#06b6d4', // cyan
      '#f97316', // orange
      '#6366f1', // indigo
      '#14b8a6', // teal
      '#eab308', // yellow
      '#a855f7', // purple
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    colors: [
      '#ec4899', // pink
      '#a855f7', // purple
      '#f43f5e', // rose
      '#d946ef', // fuchsia
      '#6366f1', // indigo
      '#8b5cf6', // violet
      '#fb7185', // light rose
      '#c084fc', // light purple
      '#818cf8', // light indigo
      '#e879f9', // light fuchsia
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    colors: [
      '#64748b', // slate
      '#94a3b8', // slate light
      '#475569', // slate dark
      '#cbd5e1', // slate lighter
      '#334155', // slate darker
      '#78716c', // stone
      '#a8a29e', // stone light
      '#57534e', // stone dark
      '#d6d3d1', // stone lighter
      '#44403c', // stone darker
    ],
  },
  {
    id: 'custom',
    label: 'Custom',
    colors: [
      '#4f46e5', // fallback — overridden by user-defined palette
      '#10b981',
      '#f59e0b',
      '#ef4444',
      '#8b5cf6',
      '#06b6d4',
      '#f97316',
      '#ec4899',
      '#14b8a6',
      '#84cc16',
    ],
  },
];

/** Look up a palette by its ID */
export function getPalette(id: ChartPaletteId): ChartPalette | undefined {
  return CHART_PALETTES.find((p) => p.id === id);
}

/**
 * Resolve a palette ID to an array of hex colors.
 *
 * @param id - The palette identifier
 * @param customColors - Optional custom colors used when id === 'custom'
 * @returns Array of hex color strings. Always returns a valid array (never empty).
 */
export function resolvePalette(
  id: string,
  customColors?: string[],
): string[] {
  // Handle custom palette
  if (id === 'custom') {
    if (customColors && customColors.length > 0) {
      return customColors;
    }
    return getPalette('custom')?.colors ?? CHART_PALETTES[0].colors;
  }

  // Try to find the palette, fallback to default
  const palette = CHART_PALETTES.find((p) => p.id === id);
  return palette?.colors ?? CHART_PALETTES[0].colors;
}

/**
 * Get a specific number of colors from a palette.
 * Cycles through the palette if the requested count exceeds palette length.
 */
export function resolvePaletteColors(
  id: string,
  count: number,
  customColors?: string[],
): string[] {
  const colors = resolvePalette(id, customColors);
  if (colors.length === 0) return [];

  // If we need fewer colors than the palette has, just return the first N
  if (count <= colors.length) {
    return colors.slice(0, count);
  }

  // If we need more colors, cycle through the palette
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    result.push(colors[i % colors.length]);
  }
  return result;
}
