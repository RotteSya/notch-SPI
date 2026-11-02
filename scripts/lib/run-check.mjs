// Bound a verification command and its owned process group; never discover unrelated PIDs.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function runCheck(command, args, { timeoutMs, graceMs = 1000, cwd, env = process.env, stdio = 'inherit' } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('A positive verification timeout is required');
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, env, stdio, detached: process.platform !== 'win32' });
    let stopped = false, stopCode, force, forceDone;
    const signal = value => {
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => {});
        } else process.kill(-child.pid, value);
      } catch (error) { if (error.code !== 'ESRCH') console.error(`verification cleanup: ${error.code}`); }
    };
    const stop = code => {
      if (stopped) return;
      stopped = true; stopCode = code;
      signal('SIGTERM');
      forceDone = new Promise(done => { force = setTimeout(() => { signal('SIGKILL'); done(); }, graceMs); });
    };
    const interrupt = () => stop(130), terminate = () => stop(143);
    process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
    const timer = setTimeout(() => { console.error(`verification timed out after ${timeoutMs}ms`); stop(124); }, timeoutMs);
    let finished = false;
    const finish = async code => {
      if (finished) return; finished = true;
      clearTimeout(timer);
      if (forceDone) await forceDone;
      clearTimeout(force);
      process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
      resolve(stopCode ?? code);
    };
    child.once('error', error => { console.error(`verification command could not start: ${error.code}`); void finish(127); });
    child.once('close', (code, sig) => { void finish(code ?? (sig === 'SIGINT' ? 130 : 1)); });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [seconds, command, ...args] = process.argv.slice(2);
  if (!command || !/^\d+$/.test(seconds ?? '')) throw new Error('Usage: run-check.mjs <seconds> <command> [args...]');
  process.exitCode = await runCheck(command, args, { timeoutMs: Number(seconds) * 1000 });
}
