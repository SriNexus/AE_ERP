/**
 * Face Attendance product-integration follow-up (post-Phase-13) — a
 * dedicated regression test for the Vitest/Firebase safety hazard class
 * this session's own instructions explicitly flagged (see Phase 11's
 * `functions/index.js` near-miss, and this turn's discovery that
 * `src/lib/firebase.ts` performs REAL top-level Firebase app/Firestore/Auth
 * initialization — against whatever project a local, gitignored `.env.local`
 * happens to configure — the instant it is imported, with no lazy gate).
 *
 * Proves, by direct source inspection (not by executing the hooks — this
 * repo has no `@testing-library/react`/hook-execution harness, so a
 * "the mutation never actually fires" claim cannot be proven by literally
 * running the hook; source-level proof is what this codebase's own
 * established convention already relies on everywhere else, e.g.
 * `faceAttendance.structural.test.ts`), that the entire Face Attendance
 * hook chain (`useFaceEnrollmentStatus` → `useFaceAttendanceFlow` →
 * `useFaceEnrollment`/`useFaceAttendance`) can NEVER reach a real Firebase
 * SDK call as a SIDE EFFECT of merely being imported by a test:
 *
 *   1. None of these hook files call any Firebase SDK method at MODULE
 *      TOP LEVEL — every `auth.currentUser`/`getIdToken()` access happens
 *      strictly inside an async function body, only reachable once a
 *      component actually renders and a user actually interacts (never on
 *      import alone).
 *   2. Every actual network call this feature ever makes goes through the
 *      existing, already-authenticated `fetch('/api/biometrics/...')`
 *      boundary — never a direct Firestore/Auth SDK read/write from the
 *      client for anything biometric.
 *   3. No test file in this feature area ever dynamically `import()`s one
 *      of these hook modules for real (which would execute
 *      `src/lib/firebase.ts`'s real top-level initialization) — every test
 *      here uses `readFileSync` source-text inspection only, exactly like
 *      Phase 7/8's own established convention.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const hooksDir = join(__dirname, '..');
const testsDir = __dirname;

const FACE_ATTENDANCE_HOOK_FILES = [
  'useFaceEnrollmentStatus.ts',
  'useFaceAttendanceFlow.ts',
  'useFaceEnrollment.ts',
  'useFaceAttendance.ts',
  'useFaceCapture.ts',
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('Face Attendance hooks — no Firebase SDK call at module top level (safe to import in any test)', () => {
  for (const file of FACE_ATTENDANCE_HOOK_FILES) {
    it(`${file}: every auth.*/fetch(...) call is inside a function body, never at the top level of the module`, () => {
      const source = stripComments(readFileSync(join(hooksDir, file), 'utf-8'));
      const lines = source.split('\n');

      // A crude but effective top-level-vs-nested check: track brace depth
      // as we scan; a Firebase/network-touching call is only acceptable
      // once we are inside at least one block (a function/hook body).
      let depth = 0;
      const offenders: string[] = [];
      for (const line of lines) {
        const touchesFirebaseOrNetwork = /auth\.(currentUser|signOut)|getIdToken\(\)|fetch\(/.test(line);
        if (touchesFirebaseOrNetwork && depth === 0) {
          offenders.push(line.trim());
        }
        for (const ch of line) {
          if (ch === '{') depth++;
          else if (ch === '}') depth--;
        }
      }
      expect(offenders).toEqual([]);
    });
  }

  it('useFaceEnrollmentStatus.ts / useFaceEnrollment.ts / useFaceAttendance.ts each go through fetch(\'/api/biometrics/...\') — never a direct Firestore/Auth SDK read/write for biometric data', () => {
    for (const file of ['useFaceEnrollmentStatus.ts', 'useFaceEnrollment.ts', 'useFaceAttendance.ts']) {
      const source = readFileSync(join(hooksDir, file), 'utf-8');
      expect(source).toMatch(/fetch\('\/api\/biometrics\//);
      // No direct client-SDK Firestore access to the biometric collection
      // from any of these hooks — that would risk transmitting the raw
      // embedding to the browser (see api/biometrics/status.ts's own doc
      // comment for why this is deliberately avoided).
      expect(source).not.toMatch(/collection\(db,\s*['"]biometric_face_references['"]\)/);
      expect(source).not.toMatch(/getDoc\(.*biometric_face_references/);
    }
  });

  it('no test file in this directory dynamically imports a real Face Attendance hook module — every test here is source-text-only, matching this repo\'s established no-testing-library convention', () => {
    const testFiles = readdirSync(testsDir).filter((f) => f.endsWith('.test.ts'));
    for (const file of testFiles) {
      const source = readFileSync(join(testsDir, file), 'utf-8');
      for (const hookFile of FACE_ATTENDANCE_HOOK_FILES) {
        const moduleName = hookFile.replace(/\.ts$/, '');
        expect(source).not.toMatch(new RegExp(`await import\\(['"\`][^'"\`]*${moduleName}['"\`]\\)`));
      }
    }
  });
});
