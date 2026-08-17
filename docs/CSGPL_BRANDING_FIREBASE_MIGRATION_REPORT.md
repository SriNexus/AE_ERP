# CSGPL Branding + Firebase Migration Report

## 1. Objective

Rebrand the ERP from "Neozy" to CSGPL (short form) / ChaitanyaSri Greentech Pvt Ltd
(full form), and migrate the application's Firebase Web App configuration to a new
Firebase project — without a blind global find-and-replace, without touching
technical identifiers, and without changing business logic, RBAC, or Firestore
structure.

## 2. Firebase Migration

- **Previous configuration**: local dev pointed at Firebase project `ae-erp-d933d`
  via `.env.local` (gitignored, never committed). Vercel Production and Preview had
  7 `VITE_FIREBASE_*` variables set for that same project.
- **New configuration applied**: `.env.local` was updated to the new Firebase Web
  App project (`sriconnect-3b6d6`) using the exact `VITE_FIREBASE_*` keys the app
  already reads in `src/lib/firebase.ts`. No new environment-variable names were
  introduced. `.env.example` already used generic placeholders and needed no change.
- **Vercel**: the 7 old `VITE_FIREBASE_*` values were removed from both the
  **Production** and **Preview** environments and replaced with the new project's
  values, via `vercel env rm` / `vercel env add`. **No deployment was triggered** —
  per explicit instruction mid-task, this run does **not** push to Vercel or GitHub.
  The new values are stored on Vercel but will only take effect on the **next**
  Production build/deploy (Vite bakes these in at build time).
- **Credential handling**: no Firebase key/secret was hardcoded into any
  `.ts`/`.tsx` source file, written to a tracked doc, or committed. Values were
  staged only in `.env.local` (gitignored) and pushed directly into Vercel's
  encrypted env var store via CLI.
- **Known gap — new project is fresh/empty**: the user confirmed `sriconnect-3b6d6`
  has no Firestore data, no deployed Firestore/Storage security rules, and no
  Firebase Auth users yet (including the demo login account). Pointing the app at
  it as-is will show the app shell and the "Missing Firebase Configuration" state
  will clear, but **actual login (including demo login) will fail** until:
  1. `firestore.rules` / `storage.rules` (already in this repo, unchanged) are
     deployed to the new project, and
  2. at least one Firebase Auth user exists there — for the demo flow specifically,
     a Firebase Auth account for `demo@neozy.in` (this identifier is intentionally
     unchanged — see §4) must be created and the demo dataset seeded via the
     existing `scripts/demo/` tooling (`npm run demo:seed`).
  This requires Firebase CLI/Console access to the new project that this run did
  not perform, since no deployment step was run this pass.
- **Server-side Admin SDK**: `api/_lib/firebase.ts` uses `FIREBASE_SERVICE_ACCOUNT_KEY`
  (a separate credential, not part of the `VITE_FIREBASE_*` Web App config the user
  supplied). No service-account key was provided for the new project, and Vercel
  currently has no `FIREBASE_SERVICE_ACCOUNT_KEY` set at all (checked via
  `vercel env ls` — it wasn't present before this migration either). The `/api/*`
  REST API will not function against the new project until that credential is
  supplied separately. This was out of scope for the Web App config given.
- **Production deployment status**: **not performed this run**, per explicit
  mid-task instruction ("don't push on Vercel or anywhere"). Local build succeeds
  cleanly with the new config sourced from `.env.local`.

## 3. Branding Migration

- **Short form**: `CSGPL` — used in the browser tab title, favicon glyph, sidebar/
  header/mobile branding (via the existing `company.shortName` config, not
  hardcoded per-component), footers, About ERP, User Guide body text, AI assistant
  system prompts, printable report footers, email template sample data, the
  flagship theme preset name, and the REST API's self-reported name.
- **Full form**: `ChaitanyaSri Greentech Pvt Ltd` — used in the desktop login hero
  ("Welcome to..."), and as `DEFAULT_COMPANY.name` in `src/config/company.ts`
  (the white-label config the app already treats as the source of truth for a
  company's formal name — it surfaces automatically anywhere the app displays
  `company.name`, e.g. Settings → About ERP → System Information → Company).
- **Areas updated** (see git diff for the full list): `index.html` (title, meta
  description, favicon glyph), `src/config/appVersion.ts` (`APP_NAME`),
  `src/config/company.ts` (`DEFAULT_COMPANY`: name/shortName/companyCode/tagline/
  email/website — placeholder template values, not live tenant data),
  `src/config/demoCompany.ts` (demo company display name/website), `src/pages/
  Login.tsx` (logo alt text, desktop hero, mobile welcome heading, both copyright
  footers), `src/features/guide/UserGuide.tsx` (modal title and all body copy),
  `src/components/settings/sections/AboutErpSection.tsx`, `src/pages/Companies.tsx`
  (B2B/B2C help text), `src/lib/useGlobalBoot.ts` (demo session document title),
  `src/services/aiService.ts` / `src/features/ai/hooks/useAiAssistant.ts` (AI
  system prompts), `src/features/cases/utils/caseReports.ts` (printed report
  footer), `src/lib/auditLogger.ts` (system-action fallback email label),
  `api/index.ts` (REST API self-reported name), `public/firebase-messaging-sw.js`
  (push notification title fallback + console log tags), `src/theme/presets.ts`
  (flagship theme preset renamed "CSGPL Blue"), `src/features/settings/
  emailRuntime.ts` (email template preview sample company name), and the demo seed
  datasets `scripts/demo/datasets/foundation.ts` / `businessGraph.ts` (demo
  company display name and demo operator display name — technical IDs unchanged).
  Matching test files were updated where they asserted on the changed display
  strings (`themeUiPresets.test.ts`, `emailRuntime.test.ts`).

## 4. Technical Identifiers Preserved

The following were intentionally **not** renamed, to protect database compatibility,
authentication, Firestore structure, existing production data, routing, RBAC, and
demo data:

- `demo@neozy.in` (`OFFICIAL_DEMO_EMAIL`, `src/config/demo.ts`) — a real Firebase
  Auth account referenced by exact-string assertions across scripts, tests, and
  the CI demo-reset workflow. Renaming it would break login and every consumer.
- `company-demo-neozy` (`DEMO_COMPANY_ID`) — the seeded Firestore document ID for
  the demo tenant. Referenced by the CI reset workflow's `--confirm=` flag.
- `NeozyDocument` — a TypeScript interface name in `src/components/shared/
  DocumentManager.tsx`, re-exported and used across ~6 files. A type identifier,
  not UI text.
- localStorage / persisted-store keys: `neozy-theme-mode`, `neozy-v1` (Zustand
  persist key), `neozy-demo-session-start`, `neozy-demo-last-activity`,
  `neozy-demo-seeded`. Renaming any of these would silently reset every existing
  user's theme preference and demo session state.
- `__NEOZY_FIREBASE__` — an internal `globalThis` namespace guarding Firebase
  runtime singleton state; not user-visible.
- `neozy-notification` — an internal Service Worker notification dedup tag.
- `neozy-demo-isolation-test` (in `package.json`'s `test:rules` script) — a
  Firebase emulator-only project ID used purely for local rules testing.
- Code comments referencing `docs/NEOZY_MASTER_IMPLEMENTATION_BLUEPRINT.md` etc. —
  these reference actual filenames that were preserved (see below), so the
  comments are accurate as written.

## 5. Historical Documentation Preserved

`docs/NEOZY_MASTER_IMPLEMENTATION_BLUEPRINT.md`, `docs/
NEOZY_MASTER_BUSINESS_WORKFLOW_GAP_AUDIT.md`, `docs/
NEOZY_PRODUCTION_READINESS_REPORT.md`, and `docs/DEMO_MODE_BUSINESS_FLOW_
REMEDIATION.md` are internal engineering/governance records (not user-facing UI).
Their filenames and content were left unchanged to preserve historical continuity
and the existing `.gitignore` whitelist that tracks them; renaming them was not
required by this migration and risked breaking cross-references.

## 6. Logo Assets — Manual Replacement Needed

`src/assets/login/demo-logo-light.png`, `demo-logo-dark.png`, and
`demo-logo-icon.png` have "NEOZY" baked into the artwork as pixels (the login
page's actual logo image). Per instruction, these were **not** auto-edited or
regenerated — doing so from a text description would produce a fabricated logo,
not a real brand asset. These three files need a real CSGPL logo supplied by the
user and dropped in at the same paths (no code changes required elsewhere; the
Login page already references them by path).

## 7. Validation

- `npx tsc --noEmit` — **passed**, no errors.
- `npm run build` — **passed**, production build completed successfully (~1m45s).
- `npx vitest run` — **passed**, 161 test files / 1924 tests, 0 failures.
- Production deployment / live login / browser verification — **not performed**,
  because deployment was explicitly withheld this run (see §2 and §8).

## 8. GitHub

**No commit was made and nothing was pushed.** Per explicit mid-task instruction
("don't push on Vercel or anywhere, just give the complete fix"), all changes were
left in the working tree only. `git status` at the end of this run shows the
modified files listed in §3 plus `.env.local` (gitignored, not stageable) and
`.gitignore` (added a whitelist line so this report file itself isn't silently
excluded by the existing `docs/*` ignore rule). Nothing was staged or committed.

When ready to commit, review with `git status` / `git diff` first (confirm no
`.env*` files or credentials are staged) and push to `main` as a normal, reviewed
change — this run intentionally stopped short of that step.

## 9. Final Status

**NOT READY for production cutover** — code changes are complete and validated
locally, but:
- Vercel Production has not been redeployed with the new Firebase config (env
  vars are staged there, but Vite only bakes them in at the *next* build).
- The new Firebase project (`sriconnect-3b6d6`) has no security rules deployed,
  no Firestore data, and no Auth users — live login will not work until that
  provisioning happens.
- Nothing has been committed or pushed to GitHub.

**READY** for: local development against the new Firebase project (once it's
provisioned), and for review of the branding diff before committing.
