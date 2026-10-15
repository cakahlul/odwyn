import {test,expect} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {fixture,script} from './fixture.js';
import {createJob} from '../../../store.js';
import {ensureTaskWorkspace,saveTaskCheckpoint,runRecordedTest,defineRoomCase} from '../../../execution/work.js';

test('real isolated checkpoints survive workers, reject concurrent overwrite and bind fresh test inputs',async()=>{
  const f=await fixture(),runtime=f.runtime,resourceId=f.resource.id;
  try{
    const execute=(job,command)=>runtime.sandbox.run(job,{resourceId,command,reason:'Disposable checkpoint proof',timeoutMs:5000},new AbortController().signal);
    const task=()=>{const job=createJob(f.store.state,{agentId:f.job.agentId,spaceId:f.job.spaceId,conversationId:f.job.conversationId,prompt:'Disposable checkpoint continuation'},false);job.status='running';return job;};
    expect((await f.exec('echo original > version.txt')).exitCode).toBe(0);
    const base=await saveTaskCheckpoint(runtime,f.job,{resourceId});
    expect(base.files).toBeUndefined();await runtime.sandbox.stop(f.job.id);
    const first=task(),second=task();
    await Promise.all([ensureTaskWorkspace(runtime,first,resourceId),ensureTaskWorkspace(runtime,second,resourceId)]);
    expect((await execute(first,'cat version.txt')).stdout.trim()).toBe('original');
    expect((await execute(first,'echo first > version.txt')).exitCode).toBe(0);
    expect((await execute(second,'echo second > version.txt')).exitCode).toBe(0);
    const winner=await saveTaskCheckpoint(runtime,first,{resourceId});
    await expect(saveTaskCheckpoint(runtime,second,{resourceId})).rejects.toThrow('conflict');
    expect(f.store.state.executionHeads[resourceId]).toBe(winner.id);
    const losing=f.store.state.checkpoints.find(item=>item.taskId===second.id);
    expect(losing.conflict).toBe(true);
    const saved=await runtime.sandbox.loadCheckpoint(second,resourceId,losing.id);
    expect(Buffer.from(saved.files.find(file=>file.path==='version.txt').data,'base64').toString().trim()).toBe('second');
    await Promise.all([runtime.sandbox.stop(first.id),runtime.sandbox.stop(second.id)]);

    const room=f.store.state.conversations.find(item=>item.id===f.job.conversationId);
    Object.assign(room,{kind:'room',memberIds:[f.job.agentId],governance:{observerIds:[]},discussion:{id:randomUUID(),status:'active'}});
    const qa=task();qa.roomRoundId=room.discussion.id;
    const item=defineRoomCase(runtime,qa,{title:'Pinned release inputs'});
    const args={resourceId,checkpointId:winner.id,reason:'Disposable checkpoint proof',caseId:item.id};
    const firstTest=await runRecordedTest(runtime,qa,{...args,command:'echo modified-by-test > version.txt; echo pass'});
    expect(firstTest.status).toBe('passed');expect(runtime.sandbox.workers.has(qa.id)).toBe(false);
    const nextTest=await runRecordedTest(runtime,qa,{...args,command:'test "$(cat version.txt)" = first'});
    expect(nextTest.status).toBe('passed');expect(nextTest.checkpointId).toBe(winner.id);expect(item.evidenceId).toBe(nextTest.id);

    const cancelled=task();cancelled.roomRoundId=room.discussion.id;
    const running=runRecordedTest(runtime,cancelled,{...args,command:script("require('node:fs').writeFileSync('/workspace/test-started','yes');await Bun.sleep(20000)"),timeoutMs:30000});
    let started=false;
    for(let n=0;n<100&&!started;n++){
      const worker=runtime.sandbox.workers.get(cancelled.id);
      if(worker){try{await worker.ready;const result=await runtime.sandbox.inside(worker,['test','-f','/workspace/test-started']);started=result.exitCode===0;}catch{}}
      if(!started)await Bun.sleep(50);
    }
    expect(started).toBe(true);
    [...runtime.executions].find(run=>run.job.id===cancelled.id).controller.abort();
    const cancellation=await running;expect(cancellation.status).toBe('cancelled');expect(runtime.sandbox.workers.has(cancelled.id)).toBe(false);expect(item.status).not.toBe('passed');
    expect(f.store.state.executionHeads[resourceId]).toBe(winner.id);
  }finally{await f.close();}
},90000);
