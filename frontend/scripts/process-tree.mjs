import { execFileSync } from 'node:child_process';

export function stopProcessTree(child) {
  if (!child || child.killed) {
    return;
  }

  if (process.platform === 'win32' && child.pid) {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    } catch {
      // Fall through to the normal signal path if taskkill cannot see the process.
    }
  }

  child.kill();
}
