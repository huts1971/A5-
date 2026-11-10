import { execFile, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const backend = path.join(root, 'backend');
const frontend = path.join(root, 'frontend');
const noBrowser = process.argv.includes('--no-browser');

const backendLog = path.join(backend, 'backend-local-server-8001.log');
const backendErr = path.join(backend, 'backend-local-server-8001.err.log');
const visitorLog = path.join(frontend, 'frontend-local-server-5173.log');
const visitorErr = path.join(frontend, 'frontend-local-server-5173.err.log');
const adminLog = path.join(frontend, 'frontend-local-server-5174.log');
const adminErr = path.join(frontend, 'frontend-local-server-5174.err.log');
const venvPython = path.join(backend, '.venv', 'Scripts', 'python.exe');
const distIndex = path.join(frontend, 'dist', 'index.html');

function run(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, ...options }, (error, stdout, stderr) => {
      resolve({ ok: !error, code: error?.code ?? 0, stdout, stderr });
    });
  });
}

function fail(message) {
  console.error('');
  console.error(`Start failed: ${message}`);
  console.error('');
  console.error('Please check README-local-run.md. For code changes, run BUILD-FRONTEND.bat first.');
  process.exit(1);
}

async function waitUrl(url, seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status >= 200 && response.status < 500) return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }
  return false;
}

async function killPort(port) {
  const result = await run('netstat.exe', ['-ano']);
  if (!result.ok) return;
  const lines = result.stdout.split(/\r?\n/).filter((line) => line.includes(`:${port}`) && line.includes('LISTENING'));
  const pids = new Set(lines.map((line) => line.trim().split(/\s+/).at(-1)).filter((pid) => /^\d+$/.test(pid ?? '')));
  for (const pid of pids) {
    await run('taskkill.exe', ['/F', '/PID', pid]);
    console.log(`Stopped PID=${pid} on port ${port}`);
  }
}

async function ensureBackendEnv() {
  console.log('[1/5] Checking backend environment');
  if (!existsSync(venvPython)) {
    fail('backend\\.venv was not found. Run the old dependency setup once or create the virtual environment first.');
  }

  const envFile = path.join(backend, '.env');
  const envExample = path.join(backend, '.env.example');
  if (!existsSync(envFile) && existsSync(envExample)) {
    copyFileSync(envExample, envFile);
    console.log('Created backend\\.env from backend\\.env.example');
  }
}

function ensureFrontendDist() {
  console.log('[2/5] Checking frontend static build');
  if (!existsSync(distIndex)) {
    fail('frontend\\dist is missing. Run BUILD-FRONTEND.bat first.');
  }
}

async function cleanPorts() {
  console.log('[3/5] Cleaning old ports');
  for (const port of [5173, 5174, 5175, 5176, 5177, 5200, 8001]) {
    await killPort(port);
  }
}

function startDetached(file, args, cwd, stdoutPath, stderrPath, extraEnv = {}) {
  closeSync(openSync(stdoutPath, 'w'));
  closeSync(openSync(stderrPath, 'w'));
  const stdout = openSync(stdoutPath, 'a');
  const stderr = openSync(stderrPath, 'a');
  const child = spawn(file, args, {
    cwd,
    detached: true,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', stdout, stderr],
    windowsHide: true,
  });
  child.unref();
}

function startServices() {
  console.log('[4/5] Starting services');
  startDetached(
    venvPython,
    ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8001'],
    backend,
    backendLog,
    backendErr,
  );
  startDetached(
    process.execPath,
    [path.join(root, 'scripts', 'serve-frontend-static.mjs')],
    root,
    visitorLog,
    visitorErr,
  );
  startDetached(
    process.execPath,
    [path.join(root, 'scripts', 'serve-frontend-static.mjs')],
    root,
    adminLog,
    adminErr,
    { FRONTEND_PORT: '5174' },
  );
}

async function openBrowser(url) {
  if (noBrowser) return;
  await run('cmd.exe', ['/d', '/c', 'start', '', url]);
}

async function main() {
  console.log('A5 AI Guide P2 stable launcher');
  console.log(`Project root: ${root}`);
  await ensureBackendEnv();
  ensureFrontendDist();
  await cleanPorts();
  startServices();

  console.log('[5/5] Waiting for services');
  const backendReady = await waitUrl('http://127.0.0.1:8001/health', 30);
  const frontendReady = await waitUrl('http://127.0.0.1:5173/', 30);
  const adminReady = await waitUrl('http://127.0.0.1:5174/', 30);

  if (!backendReady || !frontendReady || !adminReady) {
    console.warn('Services may still be starting. Check logs if the browser does not open.');
  }

  console.log('');
  console.log('Visitor: http://127.0.0.1:5173/');
  console.log('AI Guide: http://127.0.0.1:5173/guide');
  console.log('Admin: http://127.0.0.1:5174/');
  console.log('Backend docs: http://127.0.0.1:8001/docs');
  console.log('');
  console.log('Mode: static frontend server, no Vite, no hot reload.');
  console.log('After code changes: run BUILD-FRONTEND.bat, then START-HERE.bat.');

  if (frontendReady) {
    await openBrowser('http://127.0.0.1:5173/');
  }
}

main().catch((error) => fail(error.message));
