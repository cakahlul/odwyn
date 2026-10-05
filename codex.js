import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export class Codex extends EventEmitter {
  constructor({ home, workspace, command = 'codex' }) {
    super(); this.home = home; this.workspace = workspace; this.command = command;
    this.child = null; this.ready = null; this.pending = new Map(); this.nextId = 1;
  }

  start() {
    if (this.ready) return this.ready;
    mkdirSync(this.home, { recursive: true, mode: 0o700 }); mkdirSync(this.workspace, { recursive: true, mode: 0o700 });
    const args = ['app-server', '--listen', 'stdio://', '-c', `model=${JSON.stringify(process.env.SIDEKICK_MODEL || 'gpt-6.1-sol')}`, '-c', 'model_reasoning_effort="medium"', '-c', 'project_doc_max_bytes=0', '-c', 'web_search="disabled"'];
    for (const feature of ['shell_tool','unified_exec','apps','plugins','multi_agent','code_mode','view_image','skill_search','skill_mcp_dependency_install','shell_snapshot','sleep_tool','send_message_to_user_async','default_mode_request_user_input']) args.push('-c', `features.${feature}=false`);
    // Also suppress MCP servers when an explicitly supplied home has existing integrations.
    try { for (const name of Object.keys(Bun.TOML.parse(readFileSync(join(this.home, 'config.toml'), 'utf8')).mcp_servers || {})) args.push('-c', `mcp_servers.${name}.enabled=false`); } catch {}
    const child = spawn(this.command, args, { cwd: this.workspace, env: { ...process.env, CODEX_HOME: this.home }, stdio: ['pipe','pipe','pipe'] });
    this.child = child;
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let position;
      while ((position = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, position); buffer = buffer.slice(position + 1);
        if (!line.trim()) continue;
        try { this.receive(JSON.parse(line)); } catch { this.emit('protocolError', 'Codex sent an unreadable message.'); }
      }
    });
    // Do not forward raw stderr; it can include account or integration details.
    child.stderr.resume();
    child.on('error', () => this.fail(child, new Error('Codex could not start. Install Codex CLI and restart.')));
    child.on('exit', code => this.fail(child, new Error(`Codex disconnected (exit ${code}). Resume interrupted work after reconnecting.`)));
    this.ready = this.call('initialize', { clientInfo: { name: 'sidekick', title: 'Sidekick', version: '0.1.0' }, capabilities: { experimentalApi: true } })
      .then(result => { this.write({ method: 'initialized', params: {} }); return result; })
      .catch(error => { child.kill(); throw error; });
    return this.ready;
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out. Reconnect Codex and try again.`)); }, 60_000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  async request(method, params = {}) { await this.start(); return this.call(method, params); }
  write(message) { if (!this.child?.stdin.writable) throw new Error('Codex is disconnected.'); this.child.stdin.write(JSON.stringify(message) + '\n'); }
  respond(id, result) { this.write({ id, result }); }
  reject(id, message) { this.write({ id, error: { code: -32601, message } }); }
  receive(message) {
    if (message.id !== undefined && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id); this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
    } else if (message.id !== undefined && message.method) this.emit('request', message);
    else if (message.method) this.emit('notification', message);
  }
  fail(child, error) {
    if (this.child !== child) return;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); this.child = null; this.ready = null; this.emit('disconnect', error);
  }
  stop() { const child = this.child; if (child) { child.kill(); this.fail(child, new Error('Codex stopped.')); } }
}
