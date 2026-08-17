import { describe, expect, it } from 'vitest';
import { customerWorkspaceReducer, type CustomerWorkspaceState } from '../CustomerWorkspaceEngine';

const initial: CustomerWorkspaceState = {
  draft: {},
  hasUnsaved: false,
  saving: false,
  conflictPending: false,
  completedCustomerIds: [],
  sessionStartTime: 1700000000000,
};

describe('customerWorkspaceReducer — initial state', () => {
  it('starts clean: empty draft, hasUnsaved false, no completed customers', () => {
    expect(initial.draft).toEqual({});
    expect(initial.hasUnsaved).toBe(false);
    expect(initial.completedCustomerIds).toEqual([]);
  });
});

describe('customerWorkspaceReducer — SET_DRAFT_FIELD', () => {
  it('stages a field into draft and sets hasUnsaved', () => {
    const next = customerWorkspaceReducer(initial, { type: 'SET_DRAFT_FIELD', payload: { field: 'email', value: 'new@x.com' } });
    expect(next.draft).toEqual({ email: 'new@x.com' });
    expect(next.hasUnsaved).toBe(true);
  });

  it('accumulates multiple fields without dropping earlier ones', () => {
    let state = customerWorkspaceReducer(initial, { type: 'SET_DRAFT_FIELD', payload: { field: 'email', value: 'a@x.com' } });
    state = customerWorkspaceReducer(state, { type: 'SET_DRAFT_FIELD', payload: { field: 'city', value: 'Mumbai' } });
    expect(state.draft).toEqual({ email: 'a@x.com', city: 'Mumbai' });
  });

  it('overwrites a field re-edited before save', () => {
    let state = customerWorkspaceReducer(initial, { type: 'SET_DRAFT_FIELD', payload: { field: 'notes', value: 'first' } });
    state = customerWorkspaceReducer(state, { type: 'SET_DRAFT_FIELD', payload: { field: 'notes', value: 'second' } });
    expect(state.draft.notes).toBe('second');
  });
});

describe('customerWorkspaceReducer — save lifecycle', () => {
  it('SET_SAVING toggles the saving flag', () => {
    expect(customerWorkspaceReducer(initial, { type: 'SET_SAVING', payload: true }).saving).toBe(true);
    expect(customerWorkspaceReducer({ ...initial, saving: true }, { type: 'SET_SAVING', payload: false }).saving).toBe(false);
  });

  it('SET_CONFLICT_PENDING toggles the conflict flag', () => {
    expect(customerWorkspaceReducer(initial, { type: 'SET_CONFLICT_PENDING', payload: true }).conflictPending).toBe(true);
  });

  it('MARK_CLEAN clears both the draft and hasUnsaved after a successful save', () => {
    const dirty: CustomerWorkspaceState = { ...initial, draft: { email: 'a@x.com' }, hasUnsaved: true };
    const clean = customerWorkspaceReducer(dirty, { type: 'MARK_CLEAN' });
    expect(clean.draft).toEqual({});
    expect(clean.hasUnsaved).toBe(false);
  });
});

describe('customerWorkspaceReducer — session state (COMPLETE_CUSTOMER)', () => {
  it('adds a customer id to completedCustomerIds', () => {
    const next = customerWorkspaceReducer(initial, { type: 'COMPLETE_CUSTOMER', payload: { customerId: 'C-1' } });
    expect(next.completedCustomerIds).toEqual(['C-1']);
  });

  it('does not add the same customer id twice', () => {
    const once = customerWorkspaceReducer(initial, { type: 'COMPLETE_CUSTOMER', payload: { customerId: 'C-1' } });
    const twice = customerWorkspaceReducer(once, { type: 'COMPLETE_CUSTOMER', payload: { customerId: 'C-1' } });
    expect(twice.completedCustomerIds).toEqual(['C-1']);
  });
});

describe('customerWorkspaceReducer — RESET_WORKSPACE: per-customer vs per-session split', () => {
  it('wipes draft/hasUnsaved/saving/conflictPending (per-customer state)', () => {
    const dirty: CustomerWorkspaceState = {
      draft: { email: 'a@x.com' }, hasUnsaved: true, saving: true, conflictPending: true,
      completedCustomerIds: ['C-1'], sessionStartTime: 1700000000000,
    };
    const reset = customerWorkspaceReducer(dirty, { type: 'RESET_WORKSPACE' });
    expect(reset.draft).toEqual({});
    expect(reset.hasUnsaved).toBe(false);
    expect(reset.saving).toBe(false);
    expect(reset.conflictPending).toBe(false);
  });

  it('preserves completedCustomerIds and sessionStartTime (per-session state) — no leak, but no loss either', () => {
    const dirty: CustomerWorkspaceState = {
      draft: { email: 'a@x.com' }, hasUnsaved: true, saving: false, conflictPending: false,
      completedCustomerIds: ['C-1', 'C-2'], sessionStartTime: 1700000000000,
    };
    const reset = customerWorkspaceReducer(dirty, { type: 'RESET_WORKSPACE' });
    expect(reset.completedCustomerIds).toEqual(['C-1', 'C-2']);
    expect(reset.sessionStartTime).toBe(1700000000000);
  });

  it('proves Customer-A draft never leaks into Customer-B: draft is fully empty after reset, not merged/partial', () => {
    const customerAState = customerWorkspaceReducer(initial, { type: 'SET_DRAFT_FIELD', payload: { field: 'name', value: 'Customer A Name' } });
    const afterSwitch = customerWorkspaceReducer(customerAState, { type: 'RESET_WORKSPACE' });
    expect(afterSwitch.draft.name).toBeUndefined();
    expect(Object.keys(afterSwitch.draft)).toHaveLength(0);
  });
});
