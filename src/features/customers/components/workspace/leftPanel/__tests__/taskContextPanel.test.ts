import { describe, expect, it } from 'vitest';
import { summarizeTasks } from '../TaskContextPanel';

describe('summarizeTasks', () => {
  it('separates open from completed/cancelled tasks', () => {
    const tasks = [
      { id: '1', status: 'open', escalationLevel: 0, dueDate: '2026-02-01' },
      { id: '2', status: 'completed', escalationLevel: 0, dueDate: '2026-01-01' },
      { id: '3', status: 'cancelled', escalationLevel: 0, dueDate: '2026-01-01' },
    ];
    const summary = summarizeTasks(tasks);
    expect(summary.total).toBe(3);
    expect(summary.open).toHaveLength(1);
    expect(summary.open[0].id).toBe('1');
  });

  it('counts only open tasks with escalationLevel > 0 as escalated', () => {
    const tasks = [
      { id: '1', status: 'open', escalationLevel: 2, dueDate: '2026-02-01' },
      { id: '2', status: 'completed', escalationLevel: 3, dueDate: '2026-01-01' }, // completed — not counted
      { id: '3', status: 'open', escalationLevel: 0, dueDate: '2026-01-01' },
    ];
    const summary = summarizeTasks(tasks);
    expect(summary.escalated).toHaveLength(1);
    expect(summary.escalated[0].id).toBe('1');
  });

  it('sorts upcoming by soonest dueDate first, capped at 3', () => {
    const tasks = [
      { id: 'a', status: 'open', escalationLevel: 0, dueDate: '2026-05-01' },
      { id: 'b', status: 'open', escalationLevel: 0, dueDate: '2026-01-01' },
      { id: 'c', status: 'open', escalationLevel: 0, dueDate: '2026-03-01' },
      { id: 'd', status: 'open', escalationLevel: 0, dueDate: '2026-02-01' },
    ];
    const summary = summarizeTasks(tasks);
    expect(summary.upcoming.map((t: any) => t.id)).toEqual(['b', 'd', 'c']);
  });

  it('returns zeroed summary for a customer with no tasks', () => {
    const summary = summarizeTasks([]);
    expect(summary).toEqual({ total: 0, open: [], escalated: [], upcoming: [] });
  });
});
