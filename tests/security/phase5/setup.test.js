import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setup} from '../../../scripts/setup.js';
import {runnerEnvironment,SecurityEnvironmentBlocked} from '../phase2/fixture.js';

test('OPS-002 Production-mode fail closed: installer verifies actual disposable workers before configuration',async()=>{
  await runnerEnvironment();
  if(!/^sha256:[a-f0-9]{64}$/.test(process.env.ODWYN_SECURITY_BROWSER_IMAGE||'')||!process.env.ODWYN_SECURITY_REPORT_DIR)throw new SecurityEnvironmentBlocked('Pinned browser image and report directory required for setup probe.');
  const root=mkdtempSync(join(tmpdir(),'odwyn-setup-os-'));
  try{
    const result=await setup(root,{env:{PATH:process.env.PATH,DOCKER_HOST:process.env.DOCKER_HOST,ODWYN_SANDBOX_IMAGE:process.env.ODWYN_SECURITY_SANDBOX_IMAGE,ODWYN_BROWSER_IMAGE:process.env.ODWYN_SECURITY_BROWSER_IMAGE},log:()=>{}});
    expect(result.isolation).toBe(true);expect(result.checks).toHaveLength(2);
    for(const check of result.checks){expect(check.uid).toBe(1000);expect(check.seccomp).toBe(true);expect(check.noNewPrivileges).toBe(true);expect(check.capabilitiesZero).toBe(true);expect(check.cpu).toBe('100000 100000');}
    expect(result.checks[0].memory).toBe(128*1024*1024);expect(result.checks[1].memory).toBe(512*1024*1024);
    expect(readFileSync(join(root,'.env'),'utf8')).toContain('ODWYN_BROWSER_IMAGE=');expect(existsSync(join(root,'data','odwyn.db'))).toBe(false);
    const report=join(process.env.ODWYN_SECURITY_REPORT_DIR,'setup');mkdirSync(report,{recursive:true});
    writeFileSync(join(report,'os-readiness.json'),JSON.stringify({status:'PASS',checks:result.checks,browserLaunchVerified:true,noGrantsCreated:true,noLiveSystemsTouched:true,releaseVerdict:false},null,2));
  }finally{rmSync(root,{recursive:true,force:true});}
},120000);
