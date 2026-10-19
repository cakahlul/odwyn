import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Sandbox} from '../execution/sandbox.js';
import {prepareManifests} from '../scripts/prepare-executor.js';
import {prepareProjectEnvironment} from '../execution/project-environment.js';

test('Git attestation accepts exact prepared dependencies and ignored outputs while detecting changed source',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-attestation-'));
  try{
    const root=join(directory,'source'),dependencies=join(directory,'image');mkdirSync(root);mkdirSync(dependencies);
    const command=args=>Bun.spawnSync(args,{env:{PATH:process.env.PATH,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
    const git=args=>command(['git','-C',root,...args]);
    writeFileSync(join(root,'package.json'),'{}');writeFileSync(join(root,'package-lock.json'),' {"lockfileVersion":3,"packages":{}}');
    writeFileSync(join(root,'.gitignore'),'node_modules/\n.next/\n');mkdirSync(join(root,'build'));writeFileSync(join(root,'build','config.js'),'export default 1;');
    expect(git(['init','-q']).exitCode).toBe(0);expect(git(['add','.']).exitCode).toBe(0);
    expect(git(['-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','-qm','Baseline']).exitCode).toBe(0);
    const prepared=prepareManifests(root,['.'],join(directory,'context'));
    mkdirSync(join(dependencies,'dependencies','node_modules'),{recursive:true});writeFileSync(join(dependencies,'projects.json'),JSON.stringify(prepared));
    prepareProjectEnvironment(root,dependencies,true);
    const sandbox=new Sandbox({},{image:'sha256:'+'a'.repeat(64)}),job={id:'test'};
    sandbox.git=async(task,args)=>git(args);sandbox.existing=()=>({});
    // Supply the tracked tree over stdin as the real worker protocol does.
    sandbox.inside=async(worker,args,options)=>Bun.spawnSync(['bun','-e',args[2].replaceAll('/workspace',root).replaceAll('/opt/odwyn',dependencies)],{stdin:options.input,env:{PATH:process.env.PATH,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
    expect(await sandbox.gitClean(job)).toBe(true);
    mkdirSync(join(root,'.next'));writeFileSync(join(root,'.next','cache'),'generated');
    expect(await sandbox.gitClean(job)).toBe(true);
    writeFileSync(join(root,'build','config.js'),'export default 2;');
    expect(await sandbox.gitClean(job)).toBe(false);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
