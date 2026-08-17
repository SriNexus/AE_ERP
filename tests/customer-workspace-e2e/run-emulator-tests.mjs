// Phase 5.2 runtime-validation orchestrator. Starts the Firebase Auth+Firestore
// emulators (fully local, fake `demo-neozy-local` project, zero contact with
// real production), seeds test data, starts the app in emulator mode, runs the
// Playwright suite, then tears everything down. Never touches .env.local.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIRESTORE_PORT = 8080;
const AUTH_PORT = 9099;
const APP_PORT = 5199;

// Portable, no-installer Eclipse Temurin JDK — the Firebase Local Emulator
// Suite requires a JVM, and this machine has no system-wide Java install.
// Downloaded/extracted as a throwaway dev tool under .tools/, gitignored,
// never touches the system PATH or Windows Installer.
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
  // On Windows, spawn(..., {shell:true}) wraps the real process (java/node/vite)
  // inside a cmd.exe shell — a plain child.kill() only kills the shell wrapper
  // and orphans the actual process tree, which then keeps holding the emulator
  // ports across runs. taskkill /T (kill the whole tree) /F (force) is required.
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
  console.log('[1/5] Starting Firebase emulators (auth, firestore)...');
  // --config points at the permissive-rules config made specifically for this
  // harness (tests/customer-workspace-e2e/firebase.emulator-test.json) — this
  // flag was previously missing, which meant the emulator silently loaded the
  // repo's default firebase.json (the REAL, strict firestore.rules) instead.
  // Those rules depend on custom-claims/user-doc propagation this synthetic
  // seed data doesn't fully replicate, causing intermittent 403 permission-denied
  // failures on writes like customer_phone_locks — surfacing as "Save never
  // clears Unsaved changes" in the runtime specs, unrelated to any Workspace
  // code change.
  const emu = spawnTracked('npx', ['firebase', 'emulators:start', '--project', 'demo-neozy-local', '--only', 'auth,firestore', '--config', 'tests/customer-workspace-e2e/firebase.emulator-test.json'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: EMULATOR_ENV,
  });
  emu.stdout.on('data', (d) => process.stdout.write(`[emu] ${d}`));
  emu.stderr.on('data', (d) => process.stderr.write(`[emu] ${d}`));

  await waitForPort(FIRESTORE_PORT);
  await waitForPort(AUTH_PORT);
  console.log('[1/5] Emulators up.');

  console.log('[2/5] Seeding emulator data...');
  const seedEnv = {
    ...process.env,
    FIRESTORE_EMULATOR_HOST: `127.0.0.1:${FIRESTORE_PORT}`,
    FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${AUTH_PORT}`,
    GCLOUD_PROJECT: 'demo-neozy-local',
  };
  await new Promise((resolve, reject) => {
    const seed = spawn('node', ['tests/customer-workspace-e2e/seed.mjs'], { env: seedEnv, stdio: 'inherit', shell: true });
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
    const pw = spawn('npx', ['playwright', 'test', '--config', 'playwright.customer-workspace.config.ts'], {
      stdio: 'inherit', shell: true,
      env: { ...process.env, CW_E2E_BASE_URL: `http://127.0.0.1:${APP_PORT}` },
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
