console.log(`Demo Mode operator commands (passwords are never accepted):
  npm run demo:plan                         Credential-free deterministic plan
  npm run demo:seed                         Trusted seed dry-run (requires Admin credentials)
  npm run demo:seed -- --apply              Guarded seed apply
  npm run demo:verify                       Persisted graph + manifest verification
  npm run demo:readiness                    Operational go/no-go preflight
  npm run demo:reset:plan                   Credential-free reset plan
  npm run demo:reset -- --apply --confirm=RESET-company-demo-neozy
  npm run demo:cleanup                      Cleanup dry-run
  npm run demo:cleanup -- --apply --confirm=CLEANUP-company-demo-neozy-INCLUDING-IDENTITY
  npm run test:demo                          Focused Demo hardening tests
  npm run test:rules                         Firestore emulator isolation suite
Required trusted environment: DEMO_FIREBASE_PROJECT_ID, DEMO_ALLOWED_FIREBASE_PROJECTS, and Application Default Credentials or FIREBASE_SERVICE_ACCOUNT_KEY. Scheduled deployments should prefer Workload Identity Federation.`);
