import {test,expect} from 'bun:test';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
const names=[
  "MIG-001 Legacy settings fail closed",
  "MIG-002 Migration interruption and rollback",
  "REG-001 Full existing app regression",
  "E2E-001 Real runtime 3-space journey",
  "E2E-002 Real sandbox and upstream deny",
  "ATTACK-001 Prompt injection across tools",
  "ATTACK-002 Tool output spoofing",
  "REC-001 Restart + retry double-execution",
  "OPS-001 Disable integration emergency",
  "OPS-002 Production-mode fail closed"
];

// Same fresh-process boundary as BASE-003: Bun/macOS guarded FD reuse can kill
// a combined run. Each real case retains its own Bun JUnit and side-effect proof.
for(const [index,name] of names.entries())test(name,async()=>{
 const report=process.env.ODWYN_SECURITY_REPORT_DIR;if(!report)throw new Error('BLOCKED: report directory required');
 const directory=resolve(report,'phase5');mkdirSync(directory,{recursive:true});const outfile=join(directory,index+'.xml');
 const env=Object.fromEntries(['PATH','TMPDIR','DOCKER_HOST','DOCKER_CONTEXT','XDG_RUNTIME_DIR','ODWYN_SECURITY_ISOLATION_RUNNER','ODWYN_SECURITY_SANDBOX_IMAGE','ODWYN_SECURITY_BROWSER_IMAGE'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));env.ODWYN_SECURITY_REPORT_DIR=resolve(report);env.ODWYN_SECURITY_CASE=name;
 const result=await new Promise((done,fail)=>{const child=spawn(process.execPath,['test','./tests/security/phase5/cases.js','--reporter=junit','--reporter-outfile='+outfile],{env,stdio:['ignore','pipe','pipe'],detached:true});let log='';const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},590000);child.stdout.on('data',c=>log+=c);child.stderr.on('data',c=>log+=c);child.once('error',e=>{clearTimeout(timer);fail(e);});child.once('close',(code,signal)=>{clearTimeout(timer);try{process.kill(-child.pid,'SIGKILL');}catch{}done({exitCode:code??137,signal,log});});});
 writeFileSync(join(directory,index+'.log'),result.log.replaceAll(process.cwd(),'<repo>').replace(/\/Users\/[^\s:)]+/g,'<host-path>'));writeFileSync(join(directory,index+'.execution.json'),JSON.stringify({testName:name,exitCode:result.exitCode,signal:result.signal},null,2));
 if(!existsSync(outfile)){const caseId=name.slice(0,name.indexOf(' '));for(const sub of ['execution','proof'])mkdirSync(join(report,sub),{recursive:true});const blocked={caseId,status:'BLOCKED',verified:false,probeExecuted:false,reason:'BLOCKED: child Bun JUnit absent',environment:'Disposable Bun child process',observations:{probeExecuted:false}};for(const sub of ['execution','proof'])writeFileSync(join(report,sub,caseId+'.json'),JSON.stringify(blocked));throw new Error('BLOCKED: child Bun JUnit absent; exit '+result.exitCode);}
 const verified=Bun.spawnSync(['python3','-c',`import sys,xml.etree.ElementTree as ET
root=ET.parse(sys.argv[1]).getroot()
cases=root.findall('.//testcase')
assert len(cases)==1 and cases[0].get('name')==sys.argv[2], 'Missing or wrong executed case'
assert not any(c.findall('failure')+c.findall('error')+c.findall('skipped') for c in cases), 'Failed or skipped execution'
`,outfile,name]);
 const proofPath=join(report,'proof',name.split(' ')[0]+'.json'),blocked=existsSync(proofPath)&&JSON.parse(readFileSync(proofPath,'utf8')).status==='BLOCKED';
 writeFileSync(join(directory,index+'.execution.json'),JSON.stringify({caseId:name.split(' ')[0],testName:name,status:result.exitCode===0&&verified.exitCode===0?'PASS':blocked?'BLOCKED':'FAIL',exitCode:result.exitCode,signal:result.signal,junitVerified:verified.exitCode===0},null,2));expect(result.exitCode).toBe(0);expect(verified.exitCode).toBe(0);
},600000);
