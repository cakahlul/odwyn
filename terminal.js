import { spawn } from 'node:child_process';
import { textInput } from './security.js';

export function validateCommand(input) {
  const command = textInput(input?.command, 20_000);
  const reason = textInput(input?.reason, 1000);
  const timeoutMs = input.timeoutMs ?? 30_000;
  if (command.includes('\0')) throw new Error('Command cannot contain null bytes.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('Timeout must be between 1 and 120000 milliseconds.');
  return { command, reason, timeoutMs };
}

export function runCommand({ command, timeoutMs }, cwd, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    // ponytail: non-interactive POSIX shell; add a PTY only when interactive sessions are needed.
    const child = spawn('/bin/sh', ['-c', command], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = { stdout: [], stderr: [] }, sizes = { stdout: 0, stderr: 0 };
    let truncated = false, timedOut = false, cancelled = false;
    const kill = () => {
      if (!child.pid) return;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    };
    const abort = () => { cancelled = true; kill(); };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    for (const name of ['stdout', 'stderr']) child[name].on('data', chunk => {
      const remaining = 32_768 - sizes[name];
      if (chunk.length > remaining) truncated = true;
      if (remaining > 0) { const part = chunk.subarray(0, remaining); output[name].push(part); sizes[name] += part.length; }
    });
    // Stop descendants too: detached/background commands must not survive a task.
    child.once('exit', kill);
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', (exitCode, exitSignal) => {
      cleanup();
      resolve({ stdout: Buffer.concat(output.stdout).toString('utf8'), stderr: Buffer.concat(output.stderr).toString('utf8'), exitCode, signal: exitSignal, timedOut, cancelled, truncated });
    });
  });
}
