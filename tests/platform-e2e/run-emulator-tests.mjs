// Phase 8 (Master Plan §17.3) orchestrator — adapted line-for-line from
// tests/customer-workspace-e2e/run-emulator-tests.mjs's proven pattern.
// Starts the Firebase Auth+Firestore emulators (fully local, fake
// `demo-neozy-local` project, zero contact with real production) against the
// REAL firestore.rules/storage.rules (unlike the customer-workspace harness,
// which deliberately uses a permissive rules variant — this harness's whole
// point is exercising the real Group/Platform RBAC boundaries), seeds the
// Super Admin identity, starts the app in emulator mode, runs the Playwright
// suite, then tears everything down.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { copyFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIRESTORE_PORT = 8080;
const AUTH_PORT = 9099;
const APP_PORT = 5299;

// Same portable, no-installer Eclipse Temurin JDK the customer-workspace
// harness already established — the Firebase Local Emulator Suite requires
// a JVM, and this machine has no system-wide Java install on PATH.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const JDK_BIN = path.join(REPO_ROOT, '.tools', 'jdk-21.0.12+8', 'bin');
const EMULATOR_ENV = { ...process.env, PATH: `${JDK_BIN}${path.delimiter}${process.env.PATH}` };

function waitForPort(port, host = '127.0.0.1', timeoutMs = 90_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ port, host }, () => { socket.end(); resolve(true); });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) return reject(new Error(`Timed out waiting for ${host}:${port}`));
        setTimeout(attempt, 750);
      });
    };
    attempt();
  });
}

function waitForHttp(url, timeoutMs = 90_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        const res = await fetch(url);
        if (res.status < 500) return resolve(true);
        throw new Error(String(res.status));
      } catch {
        if (Date.now() - start > timeoutMs) return reject(new Error(`Timed out waiting for ${url}`));
        setTimeout(attempt, 750);
      }
    };
    attempt();
  });
}

const children = [];
function spawnTracked(cmd, args, opts) {
  const child = spawn(cmd, args, { ...opts, shell: true });
  children.push(child);
  return child;
}

function killAll() {
  for (const c of children) {
    try {
      if (process.platform === 'win32' && c.pid) {
        spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore', shell: true });
      } else {
        c.kill();
      }
    } catch { /* already dead */ }
  }
}

process.on('SIGINT', () => { killAll(); process.exit(1); });

async function main() {
  // firebase-tools refuses rules paths that escape the --config file's own
  // directory ("outside of project directory") — so the REAL, current
  // firestore.rules/storage.rules are copied in fresh on every run rather
  // than referenced via `../../`. This guarantees the E2E always tests
  // today's actual rules content, never a hand-maintained, driftable
  // duplicate (these copies are gitignored build artifacts, regenerated
  // every run — see tests/platform-e2e/.gitignore).
  copyFileSync(path.join(REPO_ROOT, 'firestore.rules'), path.join(REPO_ROOT, 'tests/platform-e2e/firestore.rules'));
  copyFileSync(path.join(REPO_ROOT, 'firestore.indexes.json'), path.join(REPO_ROOT, 'tests/platform-e2e/firestore.indexes.json'));
  copyFileSync(path.join(REPO_ROOT, 'storage.rules'), path.join(REPO_ROOT, 'tests/platform-e2e/storage.rules'));

  console.log('[1/5] Starting Firebase emulators (auth, firestore) with the REAL firestore.rules...');
  const emu = spawnTracked('npx', ['firebase', 'emulators:start', '--project', 'demo-neozy-local', '--only', 'auth,firestore', '--config', 'tests/platform-e2e/firebase.emulator-test.json'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: EMULATOR_ENV,
  });
  emu.stdout.on('data', (d) => process.stdout.write(`[emu] ${d}`));
  emu.stderr.on('data', (d) => process.stderr.write(`[emu] ${d}`));

  await waitForPort(FIRESTORE_PORT);
  await waitForPort(AUTH_PORT);
  // This sandboxed environment's Firestore/Auth emulators have a documented
  // slow cold-start (see vitest.emulator.config.ts's hookTimeout comment) —
  // the TCP port accepting a connection does not mean the emulator's HTTP
  // server is actually answering requests yet (empirically confirmed: `curl`
  // got ECONNREFUSED on port 9099 ~20s after "All emulators ready!" printed,
  // then succeeded moments later). Without waiting for a REAL HTTP response,
  // the BROWSER's first Firestore SDK connection attempt races that warm-up,
  // hits a 10s internal timeout, and falls back to permanent "offline mode"
  // for the rest of the page's lifetime (observed directly: `Could not reach
  // Cloud Firestore backend` followed by every query resolving empty). Poll
  // both emulators' real HTTP endpoints, not just their TCP ports.
  await waitForHttp(`http://127.0.0.1:${FIRESTORE_PORT}/`);
  await waitForHttp(`http://127.0.0.1:${AUTH_PORT}/`);
  console.log('[1/5] Emulators up (HTTP-verified ready).');

  console.log('[2/5] Seeding Super Admin identity...');
  const seedEnv = {
    ...process.env,
    FIRESTORE_EMULATOR_HOST: `127.0.0.1:${FIRESTORE_PORT}`,
    FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${AUTH_PORT}`,
    GCLOUD_PROJECT: 'demo-neozy-local',
  };
  await new Promise((resolve, reject) => {
    const seed = spawn('node', ['tests/platform-e2e/seed.mjs'], { env: seedEnv, stdio: 'inherit', shell: true });
    seed.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`seed.mjs exited ${code}`))));
  });
  console.log('[2/5] Seed complete.');

  console.log('[3/5] Starting app in emulator mode...');
  const app = spawnTracked('npx', ['vite', '--mode', 'emulator', '--port', String(APP_PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FIRESTORE_EMULATOR_HOST: seedEnv.FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST: seedEnv.FIREBASE_AUTH_EMULATOR_HOST },
  });
  app.stdout.on('data', (d) => process.stdout.write(`[app] ${d}`));
  app.stderr.on('data', (d) => process.stderr.write(`[app] ${d}`));
  await waitForHttp(`http://127.0.0.1:${APP_PORT}/login`);
  console.log('[3/5] App up.');

  console.log('[4/5] Running Playwright...');
  const pwExit = await new Promise((resolve) => {
    const pw = spawn('npx', ['playwright', 'test', '--config', 'playwright.platform.config.ts'], {
      stdio: 'inherit', shell: true,
      env: {
        ...process.env,
        PLATFORM_E2E_BASE_URL: `http://127.0.0.1:${APP_PORT}`,
        FIRESTORE_EMULATOR_HOST: seedEnv.FIRESTORE_EMULATOR_HOST,
        FIREBASE_AUTH_EMULATOR_HOST: seedEnv.FIREBASE_AUTH_EMULATOR_HOST,
        GCLOUD_PROJECT: 'demo-neozy-local',
      },
    });
    pw.on('exit', (code) => resolve(code ?? 1));
  });
  console.log(`[4/5] Playwright exited with code ${pwExit}.`);

  console.log('[5/5] Tearing down...');
  killAll();
  await delay(1000);
  process.exit(pwExit);
}

main().catch((err) => {
  console.error('RUN_FAILED:', err);
  killAll();
  process.exit(1);
});
