import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
if (!existsSync(`${root}/.env`)) {
  writeFileSync(`${root}/.env`, `ODWYN_USER=owner\nODWYN_PASSWORD=${randomBytes(24).toString('base64url')}\nPORT=4317\nODWYN_ORIGIN=\n`, { mode: 0o600 });
}
mkdirSync(`${root}/data`, { recursive: true, mode: 0o700 });
console.log('Ready. Credentials are in .env. Run bun start, then choose Codex, Claude Code, or an OpenAI-compatible API in first-time setup. Change it later in Settings.');
