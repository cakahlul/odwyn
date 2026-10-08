import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Codex } from '../codex.js';

test('Codex merges MCP definitions without importing unrelated config, and disables them per step', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'odwyn-mcp-config-'));
  const home = join(directory, 'odwyn'), mcpHome = join(directory, 'source');
  mkdirSync(home); mkdirSync(mcpHome);
  writeFileSync(join(mcpHome, 'config.toml'), 'model="unrelated"\n[mcp_servers.docs]\nurl="https://docs.example/mcp"\n[mcp_servers.off]\nurl="https://off.example/mcp"\nenabled=false\n');
  writeFileSync(join(home, 'config.toml'), '[mcp_servers.docs]\nurl="https://override.example/mcp"\n');
  const codex = new Codex({home,mcpHome,workspace:directory});
  codex.start = async () => {};
  codex.call = async (method, params) => params;
  try {
    const enabled = await codex.request('thread/start', {mcpEnabled:true});
    expect(enabled.config.mcp_servers.docs.url).toBe('https://override.example/mcp');
    expect(enabled.config.mcp_servers.off.enabled).toBe(false);
    expect(enabled.config.model).toBeUndefined();
    expect(enabled.mcpEnabled).toBeUndefined();
    writeFileSync(join(home, 'config.toml'), '[mcp_servers.docs]\nurl="https://override.example/mcp"\n[mcp_servers.docs.tools.read]\napproval_mode="approve"\noutput_token_limit=1000\n');
    for (const mode of ['prompt','writes']) {
      const configured = await codex.request('thread/resume',{mcpApprovalMode:mode});
      expect(configured.config.mcp_servers.docs.default_tools_approval_mode).toBe(mode);
      expect(configured.config.mcp_servers.docs.tools.read.approval_mode).toBe(mode);
      expect(configured.config.mcp_servers.docs.tools.read.output_token_limit).toBe(1000);
      expect(configured.mcpApprovalMode).toBeUndefined();
    }
    const disabled = await codex.request('thread/resume', {mcpEnabled:false});
    expect(Object.values(disabled.config.mcp_servers).every(server=>server.enabled===false)).toBe(true);
    writeFileSync(join(mcpHome, 'config.toml'), '[mcp_servers.fixture]\nurl = [');
    await expect(codex.request('thread/start')).rejects.toThrow('MCP configuration');
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

test.skipIf(!Bun.which('codex'))('real Codex App Server discovers and calls MCP tools without model inference', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'odwyn-mcp-server-'));
  const home = join(directory,'home'), mcpHome = join(directory,'source');
  mkdirSync(home); mkdirSync(mcpHome);
  const fixture = join(directory,'mcp.js');
  writeFileSync(fixture, `
import { Server } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/server/index.js'))};
import { StdioServerTransport } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/server/stdio.js'))};
import { ListToolsRequestSchema, CallToolRequestSchema } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/types.js'))};
const server = new Server({name:'odwyn-test',version:'1.0.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'echo',description:'Echo local test data',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']},annotations:{readOnlyHint:true}}]}));
server.setRequestHandler(CallToolRequestSchema,async request=>({content:[{type:'text',text:request.params.arguments.text}]}));
await server.connect(new StdioServerTransport());
`);
  writeFileSync(join(mcpHome,'config.toml'), `[mcp_servers.fixture]\ncommand=${JSON.stringify(process.execPath)}\nargs=[${JSON.stringify(fixture)}]\nrequired=true\n`);
  const codex = new Codex({home,mcpHome,workspace:directory});
  codex.on('request', message=>codex.respond(message.id,{action:'decline',content:null}));
  try {
    const {thread} = await codex.request('thread/start',{mcpEnabled:true,mcpApprovalMode:'prompt',ephemeral:false});
    const call = await codex.request('mcpServer/tool/call',{threadId:thread.id,server:'fixture',tool:'echo',arguments:{text:'MCP works'}});
    expect(JSON.stringify(call)).toContain('MCP works');
    codex.stop();
    const continued = await codex.request('thread/resume',{threadId:thread.id,history:[{type:'message',role:'user',content:[{type:'input_text',text:'Local MCP test'}]}],mcpEnabled:true,mcpApprovalMode:'writes'});
    const resumed = await codex.request('mcpServer/tool/call',{threadId:continued.thread.id,server:'fixture',tool:'echo',arguments:{text:'Resume works'}});
    expect(JSON.stringify(resumed)).toContain('Resume works');
    const disabled = await codex.request('thread/start',{mcpEnabled:false});
    await expect(codex.request('mcpServer/tool/call',{threadId:disabled.thread.id,server:'fixture',tool:'echo',arguments:{text:'must not run'}})).rejects.toThrow();
  } finally { codex.stop(); rmSync(directory,{recursive:true,force:true}); }
}, 30_000);
