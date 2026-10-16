import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Database} from 'bun:sqlite';
import {openStore,createJob} from '../store.js';
import {ensureTaskWorkspace} from '../execution/work.js';

test('deleted conversations retain checkpoint provenance across restart and enforce current access',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-retained-checkpoint-'));let store=openStore(directory);
  try{
    const source=store.state.agents[0],receiver={...source,id:randomUUID()};store.state.agents.push(receiver);
    const space=store.security.createSpace({name:'Checkpoint Space'}),repo=store.security.createResource({spaceId:space.id,type:'repository',name:'Repository',metadata:{endpoint:'https://example.invalid/project.git'}}),workspace=store.security.createResource({spaceId:space.id,type:'workspace',name:'Workspace'});
    store.security.configureExecution(true);
    const access=(agentId,read=true)=>store.security.putAccess(agentId,{revision:store.security.revision,spaceIds:[space.id],grants:[{spaceId:space.id,resourceId:workspace.id,action:'sandbox.exec',mode:'auto'},...(read?[{spaceId:space.id,resourceId:repo.id,action:'repository.read',mode:'auto'}]:[])]});
    access(source.id);access(receiver.id);
    const original=createJob(store.state,{agentId:source.id,spaceId:space.id,prompt:'Checkpoint work'});store.data.note(original,workspace.id,'sandbox.exec');store.data.note(original,repo.id,'repository.read');original.status='completed';
    const id='a'.repeat(64),record={id,resourceId:workspace.id,spaceId:space.id,taskId:original.id,agentId:source.id};store.state.checkpoints=[record];store.state.executionHeads={[workspace.id]:id};store.save();
    store.deleteConversation(original.conversationId);
    expect(store.state.jobs.some(job=>job.id===original.id)).toBe(false);
    expect(store.search('Checkpoint work')).toEqual([]);
    store.close();store=openStore(directory);store.security.configureExecution(true);
    expect(store.state.checkpoints).toEqual([record]);expect(store.state.executionHeads[workspace.id]).toBe(id);
    const fresh=createJob(store.state,{agentId:receiver.id,spaceId:space.id,prompt:'Restore work'});fresh.status='running';let restores=0;
    const runtime={store,state:store.state,changed(){},sandbox:{workers:new Map(),restore:async(job,resourceId,checkpointId)=>{restores++;return {resourceId,checkpointId};}}};
    await ensureTaskWorkspace(runtime,fresh,workspace.id);expect(restores).toBe(1);
    for(const agentId of [source.id,receiver.id]){
      access(agentId,false);
      await expect(ensureTaskWorkspace(runtime,fresh,workspace.id)).rejects.toThrow('disclosure denied');expect(restores).toBe(1);
      expect(store.security.audit().find(row=>row.action==='checkpoint.restore').reason).toContain(agentId);
      access(agentId);
    }
    const db=new Database(join(directory,'odwyn.db'));
    try{
      expect(db.query('SELECT resource_id FROM data_sources WHERE task_id=?').all(original.id)).toHaveLength(2);
      // Retained identity cannot override a conflicting live task or substitute another Space/owner.
      store.state.jobs.push({...original,agentId:receiver.id});
      await expect(ensureTaskWorkspace(runtime,fresh,workspace.id)).rejects.toThrow('disclosure denied');store.state.jobs.pop();
      const row=db.query('SELECT * FROM task_security_contexts WHERE task_id=?').get(original.id);
      for(const column of ['owner_id','space_id']){
        db.query(`UPDATE task_security_contexts SET ${column}=? WHERE task_id=?`).run(randomUUID(),original.id);
        await expect(ensureTaskWorkspace(runtime,fresh,workspace.id)).rejects.toThrow('disclosure denied');
        db.query(`UPDATE task_security_contexts SET ${column}=? WHERE task_id=?`).run(row[column],original.id);
      }
      db.query('DELETE FROM task_security_contexts WHERE task_id=?').run(original.id);
      await expect(ensureTaskWorkspace(runtime,fresh,workspace.id)).rejects.toThrow('disclosure denied');expect(restores).toBe(1);
    }finally{db.close();}
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('deleted checkpoint sources keep inherited export revocation checks',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-retained-export-'));let store=openStore(directory);
  try{
    const agentId=store.state.agents[0].id,spaceId=store.security.legacySpaceId;
    const exported=createJob(store.state,{agentId,spaceId,prompt:'Export source'}),conversation=store.state.conversations.find(c=>c.id===exported.conversationId),message={id:randomUUID(),role:'assistant',agentId,jobId:exported.id,text:JSON.stringify({summary:'Bounded export'})};conversation.messages.push(message);exported.status='completed';store.save();
    const grant=store.data.export({messageId:message.id,destinationSpaceId:spaceId,fields:['summary'],purpose:'Checkpoint input'});
    const original=createJob(store.state,{agentId,spaceId,prompt:'Checkpoint source'});store.data.readExport(original,grant.id);original.status='completed';store.save();store.deleteConversation(original.conversationId);
    store.close();store=openStore(directory);
    const fresh=createJob(store.state,{agentId,spaceId,prompt:'Checkpoint receiver'});
    expect(()=>store.data.assertHandoff(fresh,[original.id])).not.toThrow();
    store.data.revokeExport(grant.id);
    expect(()=>store.data.assertHandoff(fresh,[original.id])).toThrow('disclosure denied');
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
