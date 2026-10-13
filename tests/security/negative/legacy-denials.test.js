import { test, expect } from 'bun:test';
import { legacyProbe } from '../fixtures.js';

// Deliberately red until enforcement exists. Excluded from the characterization
// gate, executed separately with real JUnit evidence; never counted as protection.
for (const kind of ['terminal', 'search', 'memory', 'browser']) {
  test(`legacy ${kind} must not disclose another boundary's canary`, async () => {
    expect((await legacyProbe(kind)).leaked).toBe(false);
  }, 30_000);
}
