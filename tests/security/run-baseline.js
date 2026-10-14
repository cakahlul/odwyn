import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

export async function runBaseline(report, files = readdirSync('test', {recursive:true}).filter(file => /\.test\.[jt]sx?$/.test(file)).sort().map(file => join('test', file))) {
  if (!report) throw new Error('BLOCKED: report directory required');
  const directory = mkdtempSync(join(tmpdir(), 'odwyn-security-regression-'));
  mkdirSync(join(directory, 'codex'));
  const env = {PATH: process.env.PATH, TMPDIR: tmpdir(), ODWYN_DATA_DIR: join(directory, 'data'),
    ODWYN_CODEX_HOME: join(directory, 'codex'), ODWYN_PROVIDER: 'codex',
    ...Object.fromEntries(['DOCKER_HOST','DOCKER_CONTEXT','XDG_RUNTIME_DIR','ODWYN_SECURITY_ISOLATION_RUNNER','ODWYN_SECURITY_SANDBOX_IMAGE','ODWYN_SECURITY_BROWSER_IMAGE'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]])),ODWYN_SECURITY_REPORT_DIR:resolve(report)};
  const outfile = resolve(report, 'regression.junit.xml');
  const junitDirectory = resolve(report, 'regression'); mkdirSync(junitDirectory, {recursive:true});
  if (!files.length) throw new Error('BLOCKED: repository regression files missing');
  const started = Date.now();
  try {
    const executions = [];
    for (const [index, file] of files.entries()) {
      // Bun 1.3.9 on macOS can close a guarded FD across files; fresh processes
      // preserve every original assertion without sharing native handle state.
      const output = await new Promise((resolveRun, reject) => {
        const child = spawn(process.execPath, ['--no-env-file','test', file, '--reporter=junit', `--reporter-outfile=${join(junitDirectory, `${index}.xml`)}`], {env, stdio: ['ignore','pipe','pipe'], detached: true});
        let log = '', timedOut = false;
        const timer = setTimeout(() => {timedOut = true; try {process.kill(-child.pid, 'SIGKILL');} catch {}}, file.startsWith('tests/security/') ? 900_000 : 240_000);
        child.stdout.on('data', chunk => {log += chunk;}); child.stderr.on('data', chunk => {log += chunk;});
        child.once('error', error => {clearTimeout(timer); reject(error);});
        child.once('close', (code, signal) => {
          clearTimeout(timer);
          try {process.kill(-child.pid, 'SIGKILL');} catch {}
          resolveRun({exitCode: code ?? (signal === 'SIGKILL' ? 137 : 124), signal, timedOut, log});
        });
      });
      executions.push({file, ...output});
      console.log(`${output.exitCode === 0 ? 'PASS' : 'FAIL'}: ${file}`);
    }
    const output = {log: executions.map(run => run.log).join('\n'),
      exitCode: executions.find(run => run.exitCode !== 0)?.exitCode ?? 0,
      timedOut: executions.some(run => run.timedOut),
      signal: executions.find(run => run.signal)?.signal ?? null};
    const merged = Bun.spawnSync(['python3', '-c', `
import sys
from pathlib import Path
import xml.etree.ElementTree as ET
root = ET.Element('testsuites')
for index in range(int(sys.argv[3])):
    tree = ET.parse(Path(sys.argv[1]) / f'{index}.xml').getroot()
    if not tree.findall('.//testcase'):
        raise SystemExit('BLOCKED: empty regression JUnit')
    for suite in tree.findall('testsuite'):
        suite.attrib.pop('hostname', None)
        root.append(suite)
ET.ElementTree(root).write(sys.argv[2], encoding='utf-8', xml_declaration=True)
`, junitDirectory, outfile, String(files.length)]);
    if (merged.exitCode !== 0) {
      output.log += merged.stderr.toString();
      if (output.exitCode === 0) output.exitCode = 2;
    }
    // Only disposable fixture output; remove host paths before preserving logs.
    writeFileSync(join(report, 'regression.log'), output.log.replaceAll(process.cwd(), '<repo>').replaceAll(directory, '<fixture>').replace(/\/Users\/[^\s:)]+/g, '<host-path>'));
    let xml = '';
    try {xml = readFileSync(outfile, 'utf8');} catch {}
    const names = [...xml.matchAll(/<testcase\s[^>]*name="([^"]+)"/g)].map(match => match[1]);
    const failed = (xml.match(/<(?:failure|error)(?:\s|>)/g) || []).length;
    const skipped = (xml.match(/<skipped(?:\s|\/|>)/g) || []).length;
    let dependencies = true;
    for (const dependency of Object.keys(JSON.parse(readFileSync('package.json', 'utf8')).dependencies)) {
      // The MCP SDK exports modules, not a package-root entrypoint.
      const entrypoints = dependency === '@modelcontextprotocol/sdk'
        ? ['@modelcontextprotocol/sdk/server/mcp.js', '@modelcontextprotocol/sdk/client/index.js', '@modelcontextprotocol/sdk/inMemory.js']
        : [dependency];
      for (const entrypoint of entrypoints) {
        try {await import(entrypoint);} catch {dependencies = false;}
      }
    }
    return {command: 'bun test <each repository test file> --reporter=junit --reporter-outfile=<report>/regression/<index>.xml',
      files, executions: executions.map(({file,exitCode,signal,timedOut}) => ({file,exitCode,signal,timedOut})),
      junitComplete: merged.exitCode === 0,
      exitCode: output.exitCode, signal: output.signal, timedOut: output.timedOut, tests: names.length, failed, skipped,
      browserSmoke: names.some(name => name.includes('Home prioritizes work')) && names.some(name => name.includes('real browser references')),
      dependencies, durationMs: Date.now() - started, bun: Bun.version, platform: process.platform,
      credentialsInherited: false, noLiveSystemsTouched: true,
      note: 'Existing tests use disposable app data, intercepted pages and fake providers. Live authenticated check:codex and public-network check:browser scripts are excluded.'};
  } finally {rmSync(directory, {recursive: true, force: true});}
}
