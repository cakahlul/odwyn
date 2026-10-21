import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore,createJob} from '../store.js';

test('confirmed stage deletion removes its linked chain and workflow run, preserving unrelated history and files',()=>{
 const directory=mkdtempSync(join(tmpdir(),'odwyn-cascade-'));let store=openStore(directory);
 try{
  const jobs=Array.from({length:5},(_,i)=>createJob(store.state,{prompt:`Cascadephrase${i}`}));
  jobs.forEach(job=>job.status='completed');
  const [first,middle,last,branch,keep]=jobs.map(job=>store.state.conversations.find(c=>c.id===job.conversationId));
  middle.handoff={sourceRoomId:first.id};last.handoff={sourceRoomId:middle.id};branch.handoff={sourceRoomId:first.id};
  first.roomWorkflowRunId=middle.roomWorkflowRunId=last.roomWorkflowRunId='run';
  store.state.workflowRuns.push({id:'run',conversationId:last.id,roomIds:[first.id,middle.id,last.id]});
  store.state.files.push({id:'kept',jobId:jobs[0].id});store.save();
  const plan=store.conversationDeletion(middle.id);
  expect(new Set(plan.conversationIds)).toEqual(new Set([first.id,middle.id,last.id,branch.id]));
  expect(plan.workflowRunIds).toEqual(['run']);
  expect(()=>store.deleteConversation(middle.id)).toThrow('Linked room');
  jobs[2].status='running';
  expect(()=>store.deleteConversation(middle.id,plan)).toThrow('Stop');
  expect(store.state.conversations).toHaveLength(5);jobs[2].status='completed';
  expect(()=>store.deleteConversation(middle.id,{...plan,conversationIds:[middle.id]})).toThrow('changed');
  store.deleteConversation(middle.id,plan);
  expect(store.state.conversations.map(c=>c.id)).toEqual([keep.id]);
  expect(store.state.jobs.map(j=>j.id)).toEqual([jobs[4].id]);expect(store.state.workflowRuns).toEqual([]);
  expect(store.search('Cascadephrase0')).toEqual([]);expect(store.state.files[0].id).toBe('kept');
  store.close();store=openStore(directory);expect(store.state.conversations.map(c=>c.id)).toEqual([keep.id]);
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('workflow stages without handoff links delete together and failed persistence rolls back the whole deletion',()=>{
 const directory=mkdtempSync(join(tmpdir(),'odwyn-delete-rollback-')),store=openStore(directory);
 try{
  const first=createJob(store.state,{prompt:'Rollbackphrase'}),second=createJob(store.state,{prompt:'Other stage'});first.status=second.status='completed';
  store.state.workflowRuns.push({id:'workflow',conversationId:second.conversationId,roomIds:[first.conversationId,second.conversationId]});store.save();
  const plan=store.conversationDeletion(first.conversationId);expect(plan.conversationIds).toHaveLength(2);
  const serialize=store.credentials.serialize;store.credentials.serialize=()=>{throw Error('Cannot save');};
  try{expect(()=>store.deleteConversation(first.conversationId,plan)).toThrow('Cannot save');}finally{store.credentials.serialize=serialize;}
  expect(store.state.conversations).toHaveLength(2);expect(store.state.jobs).toHaveLength(2);expect(store.state.workflowRuns).toHaveLength(1);
  expect(store.search('Rollbackphrase')).toHaveLength(1);
  store.deleteConversation(first.conversationId,plan);expect(store.state.conversations).toHaveLength(0);
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
