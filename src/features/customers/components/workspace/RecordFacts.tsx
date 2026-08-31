/**
 * RecordFacts — shared presentational grid for "Work on This Customer".
 *
 * A workflow card's "done" state used to show one terse line
 * (e.g. `DQT-0001 · ₹13,22,072 · 13 Apr 2026`). This renders the SAME
 * information the workflow's own list row shows — number, customer, dates,
 * items, amount, etc. — as a clean label/value grid directly under the
 * card header.
 *
 * Pure presentation only: it takes an already-built `facts` array from the
 * caller (which sources every value from the existing record the card
 * already holds — no new query, no new model). Empty / "—" values are
 * dropped. Values wrap rather than truncate, so long names, amounts and
 * numbers stay fully visible and the row never overflows horizontally.
 */
import type { ReactNode } from 'react';

export interface RecordFact {
  label: string;
  value: ReactNode;
}

function isEmpty(value: ReactNode): boolean {
  return value == null || value === false || value === '' || value === '—' || value === '-';
}

export default function RecordFacts({ facts }: { facts: RecordFact[] }) {
  const shown = facts.filter((f) => !isEmpty(f.value));
  if (shown.length === 0) return null;

  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
      {shown.map((fact) => (
        <div key={fact.label} className="min-w-0">
          <dt className="text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-disabled)]">{fact.label}</dt>
          <dd className="mt-0.5 break-words text-[11.5px] font-medium leading-tight text-[var(--color-text-secondary)]">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
