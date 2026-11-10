import { spawn } from 'node:child_process';

const entry = process.argv[2];
const extraArgs = process.argv.slice(3);

if (entry !== 'visitor' && entry !== 'admin') {
  console.error('Usage: node scripts/dev-entry.mjs <visitor|admin> [vite args]');
  process.exit(1);
}

const defaultPort = entry === 'admin' ? '5174' : '5173';
const args = [
  'vite',
  '--configLoader',
  'native',
  '--host',
  '127.0.0.1',
  '--port',
  defaultPort,
  '--strictPort',
  ...extraArgs,
];

const child = spawn(`npx.cmd ${args.join(' ')}`, {
  env: {
    ...process.env,
    VITE_APP_ENTRY: entry,
  },
  shell: true,
  stdio: 'inherit',
  windowsHide: true,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  }
  process.exit(code ?? 0);
});
