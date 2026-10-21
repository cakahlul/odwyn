import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand, validateCommand } from '../terminal.js';

test('terminal captures output and status, bounds execution, and stops descendants', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'odwyn-terminal-'));
  const run = (command, timeoutMs = 1000, signal = new AbortController().signal) => runCommand(validateCommand({ command, reason: 'Test terminal', timeoutMs }), dir, signal);
  try {
    const result = await run('pwd; printf hello; printf problem >&2; exit 7');
    expect(result.stdout).toBe(`${realpathSync(dir)}\nhello`); expect(result.stderr).toBe('problem'); expect(result.exitCode).toBe(7);
    expect(result.timedOut).toBe(false);
    expect(() => validateCommand({ command: 'true', reason: 'Test', timeoutMs: 120001 })).toThrow('Timeout');
    expect(() => validateCommand({ command: 'true\0', reason: 'Test' })).toThrow('null');
    expect(() => validateCommand({ command: '', reason: 'Test' })).toThrow();
    const large = await run('yes x | head -c 100000');
    expect(Buffer.byteLength(large.stdout)).toBe(32768); expect(large.truncated).toBe(true);
    const timeout = await run('(sleep 0.2; touch timeout-leak) & wait', 30);
    expect(timeout.timedOut).toBe(true); expect(timeout.exitCode).not.toBe(0);
    const controller = new AbortController();
    const cancelled = run('(sleep 0.2; touch cancel-leak) & wait', 1000, controller.signal);
    controller.abort(); expect((await cancelled).cancelled).toBe(true);
    await run('(sleep 0.2; touch background-leak) & exit 0');
    await Bun.sleep(250);
    for (const name of ['timeout-leak', 'cancel-leak', 'background-leak']) expect(existsSync(join(dir, name))).toBe(false);
    expect(() => run('true', 1000, controller.signal)).toThrow();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('timeout releases commands whose detached descendants retain output pipes', async () => {
  const command = `"${process.execPath}" -e 'const {spawn}=require("node:child_process");spawn(process.execPath,["-e","setTimeout(()=>{},1500)"],{detached:true,stdio:["ignore",1,2]});setTimeout(()=>{},1500)'`;
  const started = Date.now();
  const result = await runCommand({command,timeoutMs:150},tmpdir(),new AbortController().signal);
  expect(result.timedOut).toBe(true);
  expect(Date.now()-started).toBeLessThan(1000);
});

test('shell exit and cancellation also release retained descendant pipes', async () => {
  for (const cancel of [false,true]) {
    const command = `"${process.execPath}" -e 'const {spawn}=require("node:child_process");spawn(process.execPath,["-e","setTimeout(()=>{},1500)"],{detached:true,stdio:["ignore",1,2]}).unref();${cancel ? 'setTimeout(()=>{},1500)' : ''}'`;
    const controller=new AbortController(),started=Date.now();
    const pending=runCommand({command,timeoutMs:3000},tmpdir(),controller.signal);
    const timer=cancel?setTimeout(()=>controller.abort(),150):null;
    try {
      const result=await pending;
      expect(result.cancelled).toBe(cancel);expect(result.timedOut).toBe(false);
      expect(Date.now()-started).toBeLessThan(1000);
    } finally {clearTimeout(timer);}
  }
});
