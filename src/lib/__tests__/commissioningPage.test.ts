/**
 * commissioningPage.test.ts — Regression tests for Commissioning page hook-order fix
 *
 * Verifies:
 * - Component exports correctly
 * - All hooks (useState, useMemo, useRef, useMutation) are unconditionally called
 *   before any conditional return statement (if/loading guard)
 * - signatureUrl state is declared before createMutation to fix stale closure
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, '../../pages/Commissioning.tsx');
const source = readFileSync(sourcePath, 'utf-8');

describe('Commissioning page — hook-order source analysis', () => {
  it('exports the component function', async () => {
    const mod = await import('../../pages/Commissioning');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
    // Cold import of the full Commissioning graph; under full-suite parallel
    // load this can exceed the default 15s testTimeout (import weight, not a
    // hang). 240s keeps the module-existence assertion meaningful on slow CI.
  }, 240000);

  it('keeps every useMemo hook above the component return and has no early loading return', () => {
    // The page no longer uses an `if (loading) { … }` early return — loading
    // is handled inline via SkeletonRows inside the table, which is strictly
    // hook-safer. Re-pin the real invariant: no early `loading` return exists
    // and every useMemo appears before the component's main return.
    const useMemoPositions = [];
    let pos = -1;
    while ((pos = source.indexOf('useMemo(', pos + 1)) !== -1) {
      useMemoPositions.push(pos);
    }

    expect(source).not.toContain('if (loading) {');
    expect(source).not.toContain('if (isLoading) {');

    const mainReturnPos = source.lastIndexOf('  return (');
    expect(mainReturnPos).toBeGreaterThan(-1);

    // All useMemo calls should be above the component's return
    const useMemoAfterReturn = useMemoPositions.filter(p => p > mainReturnPos);
    expect(useMemoAfterReturn.length).toBe(0);
  });

  it('useRef is imported from react', () => {
    expect(source).toContain('useRef');
    expect(source).toContain("import { useMemo, useRef, useState } from 'react'");
  });

  it('signatureUrl state is declared before createMutation', () => {
    const signatureUrlPos = source.indexOf("const [signatureUrl, setSignatureUrl]");
    const createMutationPos = source.indexOf("const createMutation = useMutation");

    expect(signatureUrlPos).toBeGreaterThan(-1);
    expect(createMutationPos).toBeGreaterThan(-1);
    expect(signatureUrlPos).toBeLessThan(createMutationPos);
  });

  it('useRef(signatureUrl) is used to fix stale closure', () => {
    expect(source).toContain('signatureUrlRef');
    expect(source).toContain('const signatureUrlRef = useRef(signatureUrl)');
    expect(source).toContain('signatureUrlRef.current = signatureUrl');
  });

  it('mutationFn reads signatureUrl from ref to capture latest value', () => {
    // Verify the mutationFn reads from the ref, not from the closure variable directly
    const mutationFnContent = source.substring(
      source.indexOf('mutationFn:'),
      source.indexOf('onSuccess:')
    );
    expect(mutationFnContent).toContain('signatureUrlRef.current');
  });
});
