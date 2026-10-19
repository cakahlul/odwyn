import {existsSync,readFileSync,readdirSync,lstatSync,symlinkSync,readlinkSync} from 'node:fs';
import {join,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';

export function prepareProjectEnvironment(root='/workspace',dependencies='/opt/odwyn',required=false){
  const manifest=join(dependencies,'projects.json');
  const projects=existsSync(manifest)?JSON.parse(readFileSync(manifest,'utf8')):[];
  const links=new Map();
  for(const project of projects){
    if(typeof project.path!=='string'||project.path&&(!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(project.path)||project.path.split('/').includes('..')))throw Error('Invalid prepared project path.');
    const directory=join(root,project.path);if(!existsSync(join(directory,'package.json')))continue;
    let matches=true;
    for(const name of Object.keys(project.hashes)){
      if(name.split('/').some(part=>!part||part==='..'||part==='.')||name.startsWith('/'))throw Error('Invalid prepared manifest path.');
      const file=join(directory,name);
      if(!existsSync(file)||createHash('sha256').update(readFileSync(file)).digest('hex')!==project.hashes[name])matches=false;
    }
    if(!matches){if(required)throw Error(`Executor setup required: rebuild prepared dependencies for ${project.path||'.'} after its npm manifests changed.`);continue;}
    for(const path of ['',...(project.workspaces||[])]){
      if(path&&(!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(path)||path.split('/').includes('..')))throw Error('Invalid workspace path.');
      const target=join(directory,path,'node_modules'),modules=join(dependencies,'dependencies',project.path,path,'node_modules');
      if(existsSync(modules)&&!existsSync(target))symlinkSync(modules,target);
      if(existsSync(modules)){
        if(!lstatSync(target).isSymbolicLink()||readlinkSync(target)!==modules)throw Error('Prepared dependency link was changed. Restore the saved checkpoint.');
        links.set(relative(root,target),modules);
      }
    }
  }
  if(required){
    let entries=0;
    function check(directory){
      for(const name of readdirSync(directory)){
        if(['.git','node_modules','.next','dist','build','coverage'].includes(name))continue;
        if(++entries>4096)throw Error('Executor preflight exceeded source bounds.');
        const file=join(directory,name),stat=lstatSync(file);
        if(stat.isSymbolicLink())throw Error('Executor preflight rejects source symbolic links.');
        if(stat.isDirectory())check(file);
        else if(name==='package.json'){
          const project=JSON.parse(readFileSync(file,'utf8'));
          let parent=directory;
          while(parent!==root&&!existsSync(join(parent,'node_modules')))parent=dirname(parent);
          if((Object.keys(project.dependencies||{}).length||Object.keys(project.devDependencies||{}).length)&&!existsSync(join(parent,'node_modules')))throw Error('Executor setup required: prepare npm dependencies before starting this stage. Worker networking is disabled.');
        }
      }
    }
    check(root);
  }
  return links;
}

if(import.meta.main)prepareProjectEnvironment('/workspace','/opt/odwyn',process.argv.at(-1)==='required');
