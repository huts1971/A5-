import { spawn } from 'node:child_process';
import { stopProcessTree } from './process-tree.mjs';

const children = [
  spawn('npm.cmd run dev:visitor', {
    env: process.env,
    shell: true,
    stdio: 'inherit',
    windowsHide: true,
  }),
  spawn('npm.cmd run dev:admin', {
    env: process.env,
    shell: true,
    stdio: 'inherit',
    windowsHide: true,
  }),
];

let shuttingDown = false;

function stopAll() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      stopProcessTree(child);
    }
  }
}

for (const child of children) {
  child.on('exit', (code) => {
    if (!shuttingDown && code && code !== 0) {
      stopAll();
      process.exit(code);
    }
  });
}

process.on('SIGINT', () => {
  stopAll();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopAll();
  process.exit(0);
});
