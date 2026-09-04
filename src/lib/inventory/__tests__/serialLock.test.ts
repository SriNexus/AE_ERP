import { describe, expect, it } from 'vitest';
import { normalizeSerial, dispatchSerialLockId, lockHeldByAnotherDispatch } from '../serialLock';

describe('INVENTORY-11 (§11a) — serialLock (pure)', () => {
  describe('normalizeSerial', () => {
    it('trims and uppercases', () => {
      expect(normalizeSerial('  sn-100  ')).toBe('SN-100');
      expect(normalizeSerial('SN-100')).toBe('SN-100');
    });
    it('is idempotent and deterministic for the same input', () => {
      expect(normalizeSerial('sn-abc')).toBe(normalizeSerial('SN-ABC'));
    });
    it('blank/nullish serials normalize to an empty string', () => {
      expect(normalizeSerial('')).toBe('');
      expect(normalizeSerial('   ')).toBe('');
      expect(normalizeSerial(undefined)).toBe('');
      expect(normalizeSerial(null)).toBe('');
    });
  });

  describe('dispatchSerialLockId', () => {
    it('is deterministic and company-scoped', () => {
      expect(dispatchSerialLockId('CO-1', 'SN-100')).toBe('CO-1_SN-100');
      expect(dispatchSerialLockId('CO-1', 'SN-100')).toBe(dispatchSerialLockId('CO-1', 'SN-100'));
    });
    it('the SAME serial in a DIFFERENT company produces a DIFFERENT lock id', () => {
      expect(dispatchSerialLockId('CO-1', 'SN-100')).not.toBe(dispatchSerialLockId('CO-2', 'SN-100'));
    });
    it('mirrors productSkuLockId\'s exact id scheme (established precedent — not a new pattern)', () => {
      // encodeURIComponent(companyId) + '_' + encodeURIComponent(normalizedSerial),
      // byte-identical shape to productSkuLockId/movementLedgerId.
      expect(dispatchSerialLockId('CO 1', 'SN 100')).toBe('CO%201_SN%20100');
    });
  });

  describe('lockHeldByAnotherDispatch', () => {
    it('null/undefined lock -> not held by another', () => {
      expect(lockHeldByAnotherDispatch(null, 'DSP-1')).toBe(false);
      expect(lockHeldByAnotherDispatch(undefined, 'DSP-1')).toBe(false);
    });
    it('a lock owned by THIS dispatch -> not held by another (idempotent retry)', () => {
      expect(lockHeldByAnotherDispatch({ dispatchId: 'DSP-1', isDeleted: false }, 'DSP-1')).toBe(false);
    });
    it('a lock owned by a DIFFERENT dispatch -> held by another (real conflict)', () => {
      expect(lockHeldByAnotherDispatch({ dispatchId: 'DSP-2', isDeleted: false }, 'DSP-1')).toBe(true);
    });
    it('a soft-deleted lock (even if owned by a different dispatch) is NOT treated as an active conflict', () => {
      expect(lockHeldByAnotherDispatch({ dispatchId: 'DSP-2', isDeleted: true }, 'DSP-1')).toBe(false);
    });
  });
});
