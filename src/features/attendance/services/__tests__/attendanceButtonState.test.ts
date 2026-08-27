/**
 * Face Attendance product-integration follow-up (post-Phase-13) —
 * `deriveAttendanceButtonState()` pure-logic tests. This is the ONE
 * function that decides what the single primary attendance action says and
 * does, so it is directly and exhaustively unit-tested (no framework/DOM
 * dependency, matches this codebase's own `attendanceRuleEngine.test.ts`
 * convention).
 */
import { describe, it, expect } from 'vitest';
import { deriveAttendanceButtonState } from '../attendanceButtonState';

describe('deriveAttendanceButtonState', () => {
  it('no attendance today, no active biometric reference -> "Mark Attendance" (first-time setup), targets checkIn', () => {
    const result = deriveAttendanceButtonState(null, 'none');
    expect(result).toEqual({ action: 'checkIn', label: 'Mark Attendance', isFirstTimeSetup: true });
  });

  it('no attendance today, an active reference already exists -> "Check In", not framed as first-time setup', () => {
    const result = deriveAttendanceButtonState(null, 'active');
    expect(result).toEqual({ action: 'checkIn', label: 'Check In', isFirstTimeSetup: false });
  });

  it('no attendance today, enrollment status not yet known (undefined, still loading) -> "Check In", never mislabels as first-time while unknown', () => {
    const result = deriveAttendanceButtonState(null, undefined);
    expect(result).toEqual({ action: 'checkIn', label: 'Check In', isFirstTimeSetup: false });
  });

  it('checked in, not checked out -> "Check Out", regardless of enrollment status (already resolved by definition — a checkIn could not exist without one)', () => {
    const result = deriveAttendanceButtonState({ checkIn: {} }, 'active');
    expect(result).toEqual({ action: 'checkOut', label: 'Check Out', isFirstTimeSetup: false });
  });

  it('checked in AND checked out (today complete) -> no action offered at all', () => {
    const result = deriveAttendanceButtonState({ checkIn: {}, checkOut: {} }, 'active');
    expect(result.action).toBeNull();
  });

  it('checked out is checked FIRST — a malformed record with checkOut but no checkIn still yields no action (never a false "Check In" that would silently skip the missing checkIn)', () => {
    const result = deriveAttendanceButtonState({ checkOut: {} }, 'active');
    expect(result.action).toBeNull();
  });

  it('a NEW day (fresh, null todayRecord) after a prior day\'s checkout correctly offers "Check In" again — action toggles back, not stuck complete', () => {
    // Simulates the next day: the parent's `todayRecord` query now resolves
    // to null (no record for the new date) rather than yesterday's completed one.
    const yesterday = deriveAttendanceButtonState({ checkIn: {}, checkOut: {} }, 'active');
    const today = deriveAttendanceButtonState(null, 'active');
    expect(yesterday.action).toBeNull();
    expect(today).toEqual({ action: 'checkIn', label: 'Check In', isFirstTimeSetup: false });
  });

  it('revoked enrollment status does not, by itself, change the derived action — the caller (CheckInPanel/Attendance.tsx) is responsible for checking `enrollmentStatus === \'revoked\'` FIRST and never reaching this function\'s result in that case', () => {
    // Documents the actual contract: this pure function has no concept of
    // "revoked blocks the button" — that branch lives in the presentational
    // layer, checked before this function is ever consulted. Included here
    // so a future change to this file cannot silently start treating
    // 'revoked' as equivalent to 'none' without a test failing.
    const result = deriveAttendanceButtonState(null, 'revoked');
    expect(result.action).toBe('checkIn');
  });

  it('undefined todayRecord (query still loading) behaves identically to null (no attendance yet)', () => {
    expect(deriveAttendanceButtonState(undefined, 'active')).toEqual(deriveAttendanceButtonState(null, 'active'));
  });
});
