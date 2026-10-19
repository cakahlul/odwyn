import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareManifests} from '../scripts/prepare-executor.js';
import {prepareProjectEnvironment} from '../execution/project-environment.js';

test('prepared npm dependencies require exact manifests and hydrate without copying source or credentials',()=>{
  const root=mkdtempSync(join(tmpdir(),'odwyn-project-'));
  try{
    const source=join(root,'source'),context=join(root,'context'),dependencies=join(root,'image');
    mkdirSync(source);mkdirSync(dependencies);
    writeFileSync(join(source,'package.json'),JSON.stringify({dependencies:{example:'1.0.0'}}));
    writeFileSync(join(source,'package-lock.json'),JSON.stringify({lockfileVersion:3,packages:{}}));
    writeFileSync(join(source,'.npmrc'),'owner-private-token');
    expect(()=>prepareProjectEnvironment(source,dependencies,true)).toThrow('Executor setup required');
    const prepared=prepareManifests(source,['.'],context);
    mkdirSync(join(dependencies,'dependencies','node_modules'),{recursive:true});
    writeFileSync(join(dependencies,'projects.json'),JSON.stringify(prepared));
    prepareProjectEnvironment(source,dependencies,true);
    expect(lstatSync(join(source,'node_modules')).isSymbolicLink()).toBe(true);
    expect(()=>readFileSync(join(context,'manifests','.npmrc'))).toThrow();
    writeFileSync(join(source,'package.json'),'{}');
    expect(()=>prepareProjectEnvironment(source,dependencies,true)).toThrow('manifests changed');
    expect(()=>prepareManifests(source,['../other'],context)).toThrow('traversal');
    writeFileSync(join(source,'package-lock.json'),JSON.stringify({lockfileVersion:3,packages:{bad:{resolved:'https://private.invalid/package'}}}));
    expect(()=>prepareManifests(source,['.'],context)).toThrow('public npm registry');
  }finally{rmSync(root,{recursive:true,force:true});}
});
