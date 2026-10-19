import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync,lstatSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const projectPath=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(value)&&!value.split('/').includes('..');

// Only package manifests enter the networked build; scripts and owner credentials do not.
export function prepareManifests(source,projects,directory){
  source=realpathSync(source);
  if(!projects.length||projects.length>20)throw Error('Choose 1 to 20 npm projects.');
  return projects.map(project=>{
    if(typeof project!=='string'||project!=='.'&&!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(project)||project.split('/').some(part=>part==='..'))throw Error('Use a relative project folder without traversal.');
    const path=project==='.'?'':project;
    let current=source;
    for(const part of path.split('/').filter(Boolean)){current=join(current,part);if(!lstatSync(current).isDirectory()||lstatSync(current).isSymbolicLink())throw Error('Project folders must not contain symbolic links.');}
    const hashes={},workspaces=[];
    const manifests=['package.json','package-lock.json'];
    for(const name of manifests){
      let parent=current;
      for(const part of name.split('/').slice(0,-1)){parent=join(parent,part);if(!lstatSync(parent).isDirectory()||lstatSync(parent).isSymbolicLink())throw Error('Workspace folders must not contain symbolic links.');}
      const file=join(current,name),stat=lstatSync(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4*1024*1024)throw Error('Use bounded regular npm manifest files.');
      const bytes=readFileSync(file),value=JSON.parse(bytes);
      if(name==='package-lock.json'&&(![2,3].includes(value.lockfileVersion)||!value.packages||value.dependencies))throw Error('Use an npm lockfile v2/v3 with package records and no legacy dependency tree.');
      if(name==='package-lock.json')for(const entry of Object.values(value.packages||{})){
        if(entry.link){
          if(!projectPath(entry.resolved)||!value.packages[entry.resolved])throw Error('Workspace links must resolve inside the project.');
          if(!workspaces.includes(entry.resolved)){workspaces.push(entry.resolved);manifests.push(entry.resolved+'/package.json');}
        }else if(entry.resolved&&!/^https:\/\/registry\.npmjs\.org\//.test(entry.resolved))throw Error('Only locked public npm registry dependencies are supported.');
      }
      hashes[name]=createHash('sha256').update(bytes).digest('hex');
      const target=join(directory,'manifests',path,name);mkdirSync(join(target,'..'),{recursive:true});writeFileSync(target,bytes,{mode:0o644});
    }
    return {path,hashes,workspaces};
  });
}

export async function prepareExecutor({source,projects=['.'],baseImage=process.env.ODWYN_SANDBOX_IMAGE,run}={}){
  if(!/^sha256:[a-f0-9]{64}$/.test(baseImage||''))throw Error('Choose a pinned npm-capable executor image.');
  const directory=mkdtempSync(join(tmpdir(),'odwyn-dependencies-'));
  try{
    const prepared=prepareManifests(source,projects,directory);
    writeFileSync(join(directory,'projects.json'),JSON.stringify(prepared));
    const baseTag='odwyn-executor-base:'+baseImage.slice(7);
    writeFileSync(join(directory,'Dockerfile'),[
      `FROM ${baseTag}`,'USER root','COPY manifests/ /opt/odwyn/dependencies/',
      ...prepared.flatMap(project=>[`WORKDIR /opt/odwyn/dependencies/${project.path}`,'RUN npm ci --ignore-scripts --no-audit --no-fund --include=dev && rm -rf /root/.npm',
        'RUN '+JSON.stringify(['node','-e',`const fs=require('fs'),p=require('path'),lock=JSON.parse(fs.readFileSync('package-lock.json'));for(const [name,item] of Object.entries(lock.packages||{}))if(item.link){fs.unlinkSync(name);fs.symlinkSync(p.join('/workspace',${JSON.stringify(project.path)},item.resolved),name)}`])]),
      'COPY projects.json /opt/odwyn/projects.json','WORKDIR /workspace','USER 1000:1000',''
    ].join('\n'));
    run||=async args=>{const child=Bun.spawn(args,{env:{PATH:process.env.PATH,DOCKER_HOST:process.env.DOCKER_HOST},stdin:'ignore',stdout:'inherit',stderr:'inherit'});if(await child.exited!==0)throw Error('Dependency image build failed.');};
    await run(['docker','tag',baseImage,baseTag]);
    await run(['docker','build','--pull=false','--iidfile',join(directory,'image-id'),directory]);
    const image=readFileSync(join(directory,'image-id'),'utf8').trim();
    if(!/^sha256:[a-f0-9]{64}$/.test(image))throw Error('Build did not produce a pinned image.');
    return image;
  }finally{rmSync(directory,{recursive:true,force:true});}
}

if(import.meta.main){
  const [source,...projects]=process.argv.slice(2);
  if(!source){console.error('Usage: bun scripts/prepare-executor.js SOURCE [PROJECT_FOLDER ...]');process.exitCode=2;}
  else try{console.log(await prepareExecutor({source:resolve(source),projects:projects.length?projects:['.']}));}catch(error){console.error(error.message);process.exitCode=1;}
}
