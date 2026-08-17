import { describe, expect, it } from 'vitest';
import { deriveNoteEntries, deriveDocumentEntries, deriveActivityEntries, deriveTransferEntries } from '../RecordContextPanels';

describe('deriveNoteEntries', () => {
  it('filters activityLog to Note-type entries only, matching UniversalNotesTab', () => {
    const customer = {
      activityLog: [
        { id: '1', type: 'Note', desc: 'Called customer', date: '2026-01-01' },
        { id: '2', type: 'Transfer', desc: 'Reassigned', date: '2026-01-02' },
        { id: '3', type: 'note', desc: 'lowercase note', date: '2026-01-03' },
      ],
    };
    const notes = deriveNoteEntries(customer);
    expect(notes).toHaveLength(2);
    expect(notes.map((n) => n.id)).toEqual(['3', '1']); // newest first
  });

  it('returns an empty array, not a crash, for a customer with no activityLog', () => {
    expect(deriveNoteEntries({})).toEqual([]);
  });
});

describe('deriveDocumentEntries', () => {
  it('reads from documents[] first, matching UniversalDocumentsTab', () => {
    const customer = { documents: [{ id: 'd1', name: 'Invoice.pdf', uploadedAt: '2026-01-01' }] };
    expect(deriveDocumentEntries(customer)).toHaveLength(1);
  });

  it('falls back to attachments[] when documents[] is absent', () => {
    const customer = { attachments: [{ id: 'a1', name: 'PAN.jpg', uploadedAt: '2026-01-01' }] };
    expect(deriveDocumentEntries(customer)).toHaveLength(1);
  });

  it('sorts newest first by uploadedAt/createdAt', () => {
    const customer = {
      documents: [
        { id: 'old', uploadedAt: '2026-01-01' },
        { id: 'new', uploadedAt: '2026-03-01' },
      ],
    };
    expect(deriveDocumentEntries(customer)[0].id).toBe('new');
  });

  it('returns 0 documents (not an error) when neither field is populated — the current real state for most Customer records', () => {
    expect(deriveDocumentEntries({ name: 'Test' })).toEqual([]);
  });
});

describe('deriveActivityEntries', () => {
  it('excludes Note-type entries, matching UniversalActivityTab', () => {
    const customer = {
      activityLog: [
        { id: '1', type: 'Note', date: '2026-01-01' },
        { id: '2', type: 'Transfer', date: '2026-01-02' },
        { id: '3', type: 'Creation', date: '2026-01-03' },
      ],
    };
    const entries = deriveActivityEntries(customer);
    expect(entries.map((e) => e.id)).toEqual(['3', '2']);
  });
});

describe('deriveTransferEntries', () => {
  it('reads transferHistory with the real field shape (fromUserName/toUserName/transferredAt)', () => {
    const customer = {
      transferHistory: [
        { fromUserName: 'A', toUserName: 'B', transferredAt: '2026-01-01T00:00:00Z' },
        { fromUserName: 'B', toUserName: 'C', transferredAt: '2026-02-01T00:00:00Z' },
      ],
    };
    const transfers = deriveTransferEntries(customer);
    expect(transfers).toHaveLength(2);
    expect(transfers[0].toUserName).toBe('C'); // newest first
  });

  it('returns an empty array for a customer that has never been reassigned', () => {
    expect(deriveTransferEntries({ assignedToName: 'Original Owner' })).toEqual([]);
  });
});
