import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {openStore,createJob} from '../store.js';
import {defaults} from '../public/profile.js';
const value={name:'Architecture',summary:'API rules',content:'Use versioned contracts.'};
test('knowledge remains versioned, persistent and assigned to agents without access grants',()=>{
 const directory=mkdtempSync('/tmp/odwyn-knowledge-');let store=openStore(directory);
 try{
  for(const input of [{...value,content:''},{...value,extra:true},{...value,content:'x'.repeat(20001)}])expect(()=>store.knowledge.create(input)).toThrow();
  const doc=store.knowledge.create(value),other=store.knowledge.create({...value,name:'Other'});
  store.state.customization={...defaults,knowledgeIds:[doc.id]};
  const job=createJob(store.state,{prompt:'Read architecture'});
  expect(store.knowledge.prepare(job,store.state.customization)).toContain(value.content);
  expect(store.knowledge.read(job,{id:doc.id}).content).toBe(value.content);
  expect(()=>store.knowledge.read(job,{id:other.id})).toThrow('assigned');
  expect(()=>store.knowledge.update(doc.id,{...value,version:0})).toThrow('Reload');
  expect(store.knowledge.update(doc.id,{...value,version:1})).toBe(doc);
  const updated=store.knowledge.update(doc.id,{...value,content:'Version two',version:1});expect(updated.version).toBe(2);
  expect(()=>store.knowledge.read(job,{id:doc.id})).toThrow('changed');
  store.close();store=openStore(directory);expect(store.state.knowledge[0].content).toBe('Version two');
  const fresh=createJob(store.state,{prompt:'Use latest'});store.knowledge.prepare(fresh,store.state.customization);
  expect(store.knowledge.read(fresh,{id:doc.id,query:'two'}).matches[0].content).toContain('Version two');
  store.knowledge.delete(doc.id,{version:2});expect(store.state.customization.knowledgeIds).toEqual([]);
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
