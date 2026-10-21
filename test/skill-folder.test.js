import {test,expect} from 'bun:test';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {importSkill,validateSkill,skillInstructions} from '../workflows.js';

test('folder resources survive validation and materialize with relative paths and binary bytes',()=>{
  const files=[{path:'references/security.md',content:Buffer.from('Check permissions.').toString('base64')},{path:'assets/example.bin',content:Buffer.from([0,255,1]).toString('base64')}];
  const skill=validateSkill(importSkill('---\nname: security-review\n---\nRead references/security.md.',files));
  expect(skill.files).toEqual(files);
  const workspace=mkdtempSync(join(tmpdir(),'skill-folder-'));
  try {
    const prompt=skillInstructions(skill,workspace),directory=prompt.match(/Skill folder: (.+)/)[1];
    expect(readFileSync(join(directory,'references/security.md'),'utf8')).toBe('Check permissions.');
    expect([...readFileSync(join(directory,'assets/example.bin'))]).toEqual([0,255,1]);
    expect(readFileSync(join(directory,'SKILL.md'),'utf8')).toBe(skill.instructions);
    expect(prompt).toContain('references/security.md');
  } finally {rmSync(workspace,{recursive:true,force:true});}
});

test('folder import rejects unsafe, conflicting, malformed and oversized resources',()=>{
  const source='---\nname: review\n---\nReview.';
  for(const path of ['../escape','/absolute','a/../b','a\\b','C:drive','SKILL.md','SKILL.md/child','a//b'])expect(()=>importSkill(source,[{path,content:''}])).toThrow();
  for(const paths of [['same','same'],['REF','ref'],['a','a/b'],['a/b','a']])expect(()=>importSkill(source,paths.map(path=>({path,content:''})))).toThrow();
  expect(()=>importSkill(source,[{path:'ref',content:'not base64'}])).toThrow();
  expect(()=>importSkill(source,Array.from({length:101},(_,i)=>({path:'ref'+i,content:''})))).toThrow();
  expect(()=>importSkill(source,[{path:'big',content:Buffer.alloc(5*1024*1024+1).toString('base64')}])).toThrow();
});
