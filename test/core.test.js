import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, createJob, enqueueSchedules, recoverJobs } from '../store.js';
import { authorize, allowedOrigin, validateAction, publicAddress } from '../security.js';

test('authenticated requests and same-origin writes only', () => {
  expect(authorize('Basic ' + Buffer.from('owner:secret').toString('base64'), 'owner', 'secret')).toBe(true);
  expect(authorize('Basic invalid', 'owner', 'secret')).toBe(false);
  expect(allowedOrigin('https://evil.test', 'https://assistant.test')).toBe(false);
  expect(allowedOrigin('https://assistant.test', 'https://assistant.test')).toBe(true);
});

test('browser input cannot execute arbitrary code or reach private IPs', () => {
  expect(() => validateAction({ action: 'evaluate', code: 'process.env' })).toThrow();
  expect(() => validateAction({ action: 'navigate', url: 'file:///etc/passwd' })).toThrow();
  expect(() => validateAction({ action: 'click', x: -1, y: 5 })).toThrow();
  expect(() => validateAction({ action: 'click' })).toThrow();
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.2', '::1', 'fc00::1', '::ffff:127.0.0.1']) expect(publicAddress(address)).toBe(false);
  expect(publicAddress('93.184.216.34')).toBe(true);
  expect(publicAddress('2606:4700:4700::1111')).toBe(true);
});

test('jobs persist, repeat schedules do not duplicate, interrupted work needs review', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sidekick-test-'));
  let store = openStore(dir);
  const job = createJob(store.state, { prompt: 'Check the KPI', interactionMode: 'confirm' });
  job.status = 'running';
  const stopping = createJob(store.state, { prompt: 'Stopping task' }); stopping.status = 'stopping';
  store.state.schedules.push({ id: 'daily', prompt: 'Check again', interactionMode: 'confirm', enabled: true, nextAt: '2026-10-05T00:00:00.000Z', intervalMinutes: 1440 });
  expect(enqueueSchedules(store.state, new Date('2026-10-05T01:00:00Z'))).toBe(1);
  expect(enqueueSchedules(store.state, new Date('2026-10-05T01:00:00Z'))).toBe(0);
  store.save(); store.close();
  store = openStore(dir);
  recoverJobs(store.state);
  expect(store.state.jobs.find(j => j.id === job.id).status).toBe('interrupted');
  expect(store.state.jobs.find(j => j.id === stopping.id).status).toBe('interrupted');
  expect(store.state.jobs.filter(j => j.scheduleId === 'daily')).toHaveLength(1);
  expect(store.state.conversations[0].messages[0].text).toBe('Check again');
  store.close(); rmSync(dir, { recursive: true });
});
