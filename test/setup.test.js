import {test,expect} from 'bun:test';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,statSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {setup} from '../scripts/setup.js';
test('setup creates private credentials, preserves existing configuration and rejects symlinks',async()=>{
 const root=mkdtempSync('/tmp/odwyn-setup-');
 try{
  await setup(root,{log:()=>{}});const file=join(root,'.env'),original=readFileSync(file,'utf8');
  expect(original).toContain('ODWYN_PASSWORD=');expect(original).not.toContain('DOCKER');expect(statSync(file).mode&0o777).toBe(0o600);
  await setup(root,{log:()=>{}});expect(readFileSync(file,'utf8')).toBe(original);
  rmSync(file);writeFileSync(join(root,'owner'),'keep');symlinkSync(join(root,'owner'),file);
  await expect(setup(root,{log:()=>{}})).rejects.toThrow();expect(readFileSync(join(root,'owner'),'utf8')).toBe('keep');
 }finally{rmSync(root,{recursive:true,force:true});}
});
