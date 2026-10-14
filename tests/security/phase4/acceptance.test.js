import {test,expect} from 'bun:test';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
const names=[
  "APPR-001 High-risk blocked without approval",
  "APPR-002 Single-use approval",
  "APPR-003 Payload binding",
  "APPR-004 Expiry and revocation",
  "APPR-005 Authenticated owner only",
  "APPR-006 Recheck grants before execute",
  "AUD-001 Policy audit and sanitization",
  "UX-001 Arbitrary name UX",
  "UX-002 Effective permission preview",
  "APPR-005 Authenticated owner only: privileged policy expansion needs a fresh password",
  "AUD-001 Policy audit and sanitization: secret-bearing trusted events never persist plaintext",
  "APPR-001 High-risk blocked without approval: provider completion preserves owner review and explicit execution",
  "APPR-002 Single-use approval: identical retry cannot mint another payable approval",
  "APPR-005 Authenticated owner only: real approval UI authenticates and executes its fixed preview",
  "APPR-006 Recheck grants before execute: emergency Space pause removes a real worker and persists",
  "APPR-004 Expiry and revocation: consumed approvals remain unusable after store reload",
  "APPR-001 High-risk blocked without approval: low-risk Ask writes only after bound approval",
  "APPR-003 Payload binding: changed upstream target version fails without replay",
  "UX-002 Effective permission preview: exact Deny overrides inherited Auto and all pause scopes resume",
  "UX-001 Arbitrary name UX: default Space binds new routines and immutable conversations",
  "APPR-006 Recheck grants before execute: emergency pause aborts a held real action HTTP request",
  "APPR-003 Payload binding: connector substitution cannot reuse an approved envelope"
];

// Same fresh-process boundary as BASE-003: Bun/macOS guarded FD reuse can kill
// a combined run. Each real case retains its own Bun JUnit and side-effect proof.
for(const [index,name] of names.entries())test(name,async()=>{
 const report=process.env.ODWYN_SECURITY_REPORT_DIR;if(!report)throw new Error('BLOCKED: report directory required');
 const directory=resolve(report,'phase4');mkdirSync(directory,{recursive:true});const outfile=join(directory,index+'.xml');
 const env=Object.fromEntries(['PATH','TMPDIR','DOCKER_HOST','DOCKER_CONTEXT','XDG_RUNTIME_DIR','ODWYN_SECURITY_ISOLATION_RUNNER','ODWYN_SECURITY_SANDBOX_IMAGE'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));env.ODWYN_SECURITY_REPORT_DIR=resolve(report);env.ODWYN_SECURITY_CASE=name;
 const result=await new Promise((done,fail)=>{const child=spawn(process.execPath,['--no-env-file','test','./tests/security/phase4/cases.js','--reporter=junit','--reporter-outfile='+outfile],{env,stdio:['ignore','pipe','pipe'],detached:true});let log='';const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},65000);child.stdout.on('data',c=>log+=c);child.stderr.on('data',c=>log+=c);child.once('error',e=>{clearTimeout(timer);fail(e);});child.once('close',(code,signal)=>{clearTimeout(timer);try{process.kill(-child.pid,'SIGKILL');}catch{}done({exitCode:code??137,signal,log});});});
 writeFileSync(join(directory,index+'.log'),result.log.replaceAll(process.cwd(),'<repo>').replace(/\/Users\/[^\s:)]+/g,'<host-path>'));writeFileSync(join(directory,index+'.execution.json'),JSON.stringify({testName:name,exitCode:result.exitCode,signal:result.signal},null,2));
 if(!existsSync(outfile)){const caseId=name.slice(0,name.indexOf(' '));for(const sub of ['execution','proof'])mkdirSync(join(report,sub),{recursive:true});const blocked={caseId,status:'BLOCKED',verified:false,probeExecuted:false,reason:'BLOCKED: child Bun JUnit absent',environment:'Disposable Bun child process',observations:{probeExecuted:false}};for(const sub of ['execution','proof'])writeFileSync(join(report,sub,caseId+'.json'),JSON.stringify(blocked));throw new Error('BLOCKED: child Bun JUnit absent; exit '+result.exitCode);}
 const verified=Bun.spawnSync(['python3','-c',`import sys,xml.etree.ElementTree as ET
root=ET.parse(sys.argv[1]).getroot()
cases=root.findall('.//testcase')
assert len(cases)==1 and cases[0].get('name')==sys.argv[2], 'Missing or wrong executed case'
assert not any(c.findall('failure')+c.findall('error')+c.findall('skipped') for c in cases), 'Failed or skipped execution'
`,outfile,name]);
 writeFileSync(join(directory,index+'.execution.json'),JSON.stringify({caseId:name.split(' ')[0],testName:name,status:result.exitCode===0&&verified.exitCode===0?'PASS':'FAIL',exitCode:result.exitCode,signal:result.signal,junitVerified:verified.exitCode===0},null,2));expect(result.exitCode).toBe(0);expect(verified.exitCode).toBe(0);
},70000);
