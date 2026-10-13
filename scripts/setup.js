import { existsSync, mkdirSync, writeFileSync, readFileSync, lstatSync, renameSync, rmSync, chmodSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { Sandbox } from '../execution/sandbox.js';

const imageId=/^sha256:[a-f0-9]{64}$/;
const keys=['DOCKER_HOST','ODWYN_SANDBOX_IMAGE','ODWYN_BROWSER_IMAGE','ODWYN_SANDBOX_SNAPSHOTS'];
async function verifyWorkers(config){
  const checks=[];
  for(const browser of [false,true]){
    const executor=new Sandbox(null,{image:config[browser?'ODWYN_BROWSER_IMAGE':'ODWYN_SANDBOX_IMAGE']});
    executor.env.DOCKER_HOST=config.DOCKER_HOST;
    const worker={id:`odwyn-setup-${randomUUID()}`,context:{taskId:'setup',spaceId:'setup'}};
    try{
      const health=await executor.create(worker,browser?{memory:512,pids:128,temporary:128}:{});
      if(browser){
        const result=await executor.inside(worker,['bun','/app/execution/browser-worker.js'],{input:JSON.stringify({url:'https://setup.invalid/',html:'<html><body>odwyn-setup-probe</body></html>'}),timeoutMs:30000,limit:131072});
        if(result.exitCode!==0||result.timedOut||result.truncated||!result.stdout.toString().includes('odwyn-setup-probe'))throw new Error('Isolated browser readiness check failed.');
      }
      checks.push({worker:browser?'browser':'terminal',uid:health.uid,seccomp:/^Seccomp:\s+2$/m.test(health.status),noNewPrivileges:/^NoNewPrivs:\s+1$/m.test(health.status),capabilitiesZero:/^CapEff:\s+0+$/m.test(health.status),memory:Number(health.memory),pids:Number(health.pids),cpu:health.cpu});
    }finally{await executor.required(['rm','-f',worker.id]);}
  }
  return checks;
}

export async function setup(root,{isolation=true,env=process.env,run,verify=verifyWorkers,log=console.log}={}){
  root=resolve(root);const file=join(root,'.env');
  if(existsSync(file)&&!lstatSync(file).isFile())throw new Error('Setup requires a regular .env file.');
  if(!existsSync(file))writeFileSync(file,`ODWYN_USER=owner\nODWYN_PASSWORD=${randomBytes(24).toString('base64url')}\nPORT=4317\nODWYN_ORIGIN=\n`,{mode:0o600,flag:'wx'});
  chmodSync(file,0o600);mkdirSync(join(root,'data'),{recursive:true,mode:0o700});
  log('Credentials stay in .env. Run bun run start, then configure your provider and agents.');
  if(!isolation){log('Isolated tools remain denied unless already configured.');return {isolation:false};}
  const text=readFileSync(file,'utf8');const config={};
  for(const key of keys){const raw=text.match(new RegExp(`^${key}=(.*)$`,'m'))?.[1]?.trim();config[key]=env[key]||(raw?.startsWith('"')?JSON.parse(raw):raw?.startsWith("'")?raw.slice(1,-1):raw)||'';}
  config.DOCKER_HOST||=process.platform==='darwin'?`unix://${join(homedir(),'.docker/run/docker.sock')}`:`unix:///run/user/${process.getuid?.()}/docker.sock`;
  if(!config.DOCKER_HOST.startsWith('unix://')||keys.some(key=>/[\r\n\x00$]/.test(config[key])))throw new Error('Setup requires local Docker and literal, single-line configuration values.');
  const commandEnv={PATH:env.PATH||process.env.PATH,DOCKER_HOST:config.DOCKER_HOST};
  run||=async args=>{
    const build=args[1]==='build';const child=Bun.spawn(args,{cwd:root,env:commandEnv,stdin:'ignore',stdout:build?'inherit':'pipe',stderr:'inherit'});
    const timer=setTimeout(()=>child.kill(),build?600000:30000);
    try{const output=build?'':await new Response(child.stdout).text();if(await child.exited!==0)throw new Error('Setup command failed: '+args.slice(0,2).join(' '));return output.trim();}finally{clearTimeout(timer);}
  };
  let info;
  try{info=JSON.parse(await run(['docker','info','--format','{"os":{{json .OSType}},"system":{{json .OperatingSystem}},"security":{{json .SecurityOptions}},"cgroups":{{json .CgroupVersion}}}']));}
  catch{log('Docker unavailable. Isolated tools remain denied. Install rootless Docker on Linux or start Docker Desktop on macOS, then rerun bun run setup. See execution/README.md.');return {isolation:false};}
  if(info.os!=='linux'||String(info.cgroups)!=='2'||!(info.security?.some(s=>s.includes('rootless'))||process.platform==='darwin'&&info.system==='Docker Desktop')){
    log('Unsupported Docker backend. Isolated tools remain denied. Rootless Linux Docker with cgroup v2 is required (Docker Desktop supports local macOS use).');return {isolation:false};
  }
  for(const [key,tag,args] of [
    ['ODWYN_SANDBOX_IMAGE','odwyn-security-worker:setup',['execution']],
    ['ODWYN_BROWSER_IMAGE','odwyn-security-browser:setup',['-f','execution/Dockerfile.browser','.']]
  ]){
    if(config[key]){if(!imageId.test(config[key]))throw new Error('Existing worker configuration must use an immutable sha256 image ID.');continue;}
    log('Building '+tag+' (downloads dependencies; existing grants remain unchanged).');
    await run(['docker','build','--pull=false','-t',tag,...args]);
    config[key]=(await run(['docker','image','inspect',tag,'--format','{{.Id}}'])).trim();
    if(!imageId.test(config[key]))throw new Error('Docker did not return an immutable image ID.');
  }
  config.ODWYN_SANDBOX_SNAPSHOTS||=join(root,'workspaces');
  if(!config.ODWYN_SANDBOX_SNAPSHOTS.startsWith('/')||/[\r\n\x00$]/.test(config.ODWYN_SANDBOX_SNAPSHOTS))throw new Error('Workspace snapshot root must be an absolute literal path.');
  const checks=await verify(config);
  if(!lstatSync(file).isFile()||readFileSync(file,'utf8')!==text)throw new Error('Owner configuration changed during setup; retry without overwriting it.');
  mkdirSync(config.ODWYN_SANDBOX_SNAPSHOTS,{recursive:true,mode:0o700});
  let updated=text;
  for(const key of keys){const line=`${key}=${JSON.stringify(config[key])}`;const pattern=new RegExp(`^${key}=.*$`,'gm');updated=pattern.test(updated)?updated.replace(pattern,()=>line):updated+(updated.endsWith('\n')?'':'\n')+line+'\n';}
  const temporary=file+'.setup-'+randomUUID();
  try{writeFileSync(temporary,updated,{mode:0o600,flag:'wx'});renameSync(temporary,file);}finally{rmSync(temporary,{force:true});}
  log('Worker kernel controls and browser startup verified; configuration saved. Choose Spaces, resources and permissions in Access & Autonomy. No permissions were granted. This is readiness, not a security release gate.');
  return {isolation:true,config,checks};
}

if(import.meta.main){
  const args=process.argv.slice(2);
  if(args.some(a=>!['--chat-only','--isolation'].includes(a))||args.includes('--chat-only')&&args.includes('--isolation')){console.error('Usage: bun run setup [--chat-only | --isolation]');process.exitCode=2;}
  else try{const result=await setup(resolve(import.meta.dir,'..'),{isolation:!args.includes('--chat-only')});if(args.includes('--isolation')&&!result.isolation)process.exitCode=2;}
  catch{console.error('Isolated setup failed; no new worker configuration was saved. Chat remains available. Check Docker, dependencies and existing image configuration, then rerun bun run setup.');process.exitCode=2;}
}
