import {randomUUID,randomBytes,createHash} from 'node:crypto';

export const stateData=Symbol('server classified data');
const digest=text=>createHash('sha256').update(text).digest('hex');
const uuid=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
const readAction=action=>({'sandbox.exec':'workspace.read','browser.navigate':'browser.read','browser.interact':'browser.read','memory.write':'memory.read','repository.branch.push':'repository.read'}[action]||action);
const proposalDigest=outcome=>digest(JSON.stringify(outcome.artifacts===undefined?[outcome.result,outcome.nextPlan]:[outcome.result,outcome.nextPlan,outcome.artifacts,...(outcome.checks===undefined?[]:[outcome.checks])]));
const roomExportDigest=(room,message)=>digest(JSON.stringify([room?.discussion?.id,room?.discussion?.status,room?.discussion?.invalidatedReason,message?.text,room?.discussion?.outcome?.id,room?.discussion?.outcome?.ownerDecision,(room?.artifacts||[]).map(item=>[item.id,item.versions.at(-1)?.id,item.versions.at(-1)?.reviews])]));
export function openData(db,state,policy){
  db.exec(`CREATE TABLE IF NOT EXISTS classified_conversations(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,agent_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS classified_messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,space_id TEXT NOT NULL,agent_id TEXT NOT NULL,task_id TEXT,digest TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS data_sources(task_id TEXT NOT NULL,resource_id TEXT NOT NULL,action TEXT NOT NULL,PRIMARY KEY(task_id,resource_id,action));
    CREATE TABLE IF NOT EXISTS classified_files(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,task_id TEXT,resource_id TEXT);
    CREATE TABLE IF NOT EXISTS space_memory(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,resource_id TEXT NOT NULL,task_id TEXT NOT NULL,text TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS data_exports(id TEXT PRIMARY KEY,message_id TEXT NOT NULL,source_digest TEXT NOT NULL,destination_space TEXT NOT NULL,purpose TEXT NOT NULL,payload TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS task_tokens(digest TEXT PRIMARY KEY,task_id TEXT NOT NULL,expires_at INTEGER NOT NULL);`);
  db.exec(`CREATE TABLE IF NOT EXISTS workflow_output_sources(run_id TEXT NOT NULL,step_id TEXT NOT NULL,task_id TEXT NOT NULL,PRIMARY KEY(run_id,step_id));
    CREATE TABLE IF NOT EXISTS room_proposal_sources(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,digest TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS task_exports(task_id TEXT NOT NULL,export_id TEXT NOT NULL,PRIMARY KEY(task_id,export_id));`);
  const sources=id=>db.query('SELECT resource_id AS resourceId,action FROM data_sources WHERE task_id=?').all(id);
  const task=id=>{const j=state.jobs.find(j=>j.id===id);if(!j)throw new Error('Source task unavailable.');policy.identity(j);return j;};
  const validExport=(spaceId,id,seen=new Set())=>{
    if(seen.has(id)||seen.size>=100)throw new Error('Export dependency cycle or limit.');seen.add(id);
    const row=db.query('SELECT * FROM data_exports WHERE id=?').get(id),message=row&&state.conversations.flatMap(c=>c.messages).find(m=>m.id===row.message_id),payload=row&&JSON.parse(row.payload),handoff=payload?.roomHandoff;
    const source=handoff&&state.conversations.find(room=>room.id===handoff.sourceRoomId);
    const sourceDigest=handoff?roomExportDigest(source,message):message&&digest(message.text);
    if(!row||row.revoked||row.destination_space!==spaceId||!message||sourceDigest!==row.source_digest||handoff&&source?.discussion?.status!=='completed')throw new Error('Export denied, changed or revoked.');
    for(const upstream of handoff?.upstreamExports||[])validExport(upstream.spaceId,upstream.id,seen);
    seen.delete(id);return row;
  };
  const allowed=(job,taskId)=>{try{
    const c=policy.context(job);if(!taskId)return true;const source=task(taskId);if(source.spaceId!==c.spaceId)return false;
    for(const row of db.query('SELECT export_id FROM task_exports WHERE task_id=?').all(taskId))validExport(c.spaceId,row.export_id);
    return sources(taskId).every(ref=>policy.simulate({agentId:source.agentId,spaceId:c.spaceId,...ref,...(ref.action==='sandbox.exec'?{action:readAction(ref.action)}:{})}).mode==='auto'&&policy.simulate({agentId:c.agentId,spaceId:c.spaceId,resourceId:ref.resourceId,action:readAction(ref.action)}).mode==='auto');
  }catch{return false;}};
  const data={
    sync(){
      for(const c of state.conversations){
        db.query('INSERT OR IGNORE INTO classified_conversations VALUES(?,?,?)').run(c.id,c.spaceId||policy.legacySpaceId,c.agentId);
        const space=db.query('SELECT space_id FROM classified_conversations WHERE id=?').get(c.id).space_id;
        if(c.spaceId && c.spaceId!==space)throw new Error('Conversation classification cannot change.');
        for(const m of c.messages){const source=m.role!=='user'&&m.jobId?state.jobs.find(j=>j.id===m.jobId):null;
          if(source && policy.identity(source).spaceId!==space)throw new Error('Message classification mismatch.');
          db.query('INSERT INTO classified_messages VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET digest=excluded.digest').run(m.id,c.id,space,m.agentId||c.agentId,source?.id||null,digest(m.text||''));
        }
      }
      for(const f of state.files){
        const job=f.jobId?state.jobs.find(j=>j.id===f.jobId):null;
        const spaceId=job?policy.identity(job).spaceId:f.spaceId||policy.legacySpaceId;
        db.query('INSERT OR IGNORE INTO classified_files VALUES(?,?,?,?)').run(f.id,spaceId,job?.id||null,f.resourceId||null);
      }
    },
    note(job,resourceId,action){policy.authorize(job,action,resourceId);db.query('INSERT OR IGNORE INTO data_sources VALUES(?,?,?)').run(job.id,resourceId,action);},
    readable(job,messageId){
      const c=policy.context(job),row=db.query('SELECT * FROM classified_messages WHERE id=?').get(messageId);
      if(!row||row.space_id!==c.spaceId)return false;
      const conversation=state.conversations.find(v=>v.id===row.conversation_id);if(!conversation)return false;
      if(conversation.id!==job.conversationId && (conversation.kind==='room'?!conversation.memberIds.includes(c.agentId):conversation.agentId!==c.agentId))return false;
      if(!allowed(job,row.task_id))return false;
      if(conversation.kind==='room'){try{data.roomCheck({...job,conversationId:conversation.id},row.task_id?sources(row.task_id):[]);}catch{return false;}}
      return true;
    },
    history(job,conversationId){
      const c=policy.context(job),row=db.query('SELECT * FROM classified_conversations WHERE id=?').get(conversationId);
      if(!row||row.space_id!==c.spaceId)throw new Error('History access denied.');
      const conversation=state.conversations.find(v=>v.id===conversationId);
      if(!conversation || conversationId!==job.conversationId && (conversation.kind==='room'?!conversation.memberIds.includes(c.agentId):row.agent_id!==c.agentId))throw new Error('History access denied.');
      const result=conversation.messages.filter(m=>data.readable(job,m.id));if(result.length<conversation.messages.length)policy.auditData(job,'history.read',conversationId);return result;
    },
    assertHandoff(job,taskIds){for(const id of taskIds){if(!allowed(job,id))throw new Error('Classified workflow disclosure denied.');for(const r of sources(id))db.query('INSERT OR IGNORE INTO data_sources VALUES(?,?,?)').run(job.id,r.resourceId,readAction(r.action));for(const r of db.query('SELECT export_id FROM task_exports WHERE task_id=?').all(id))db.query('INSERT OR IGNORE INTO task_exports VALUES(?,?)').run(job.id,r.export_id);}},
    workflowOutput(run,step,job){policy.context(job);db.query('INSERT OR REPLACE INTO workflow_output_sources VALUES(?,?,?)').run(run.id,step.id,job.id);},
    workflowKeys(run,step){const paths=[...JSON.stringify(step).matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map(m=>m[1]);return paths.includes('steps')?Object.keys(run.outputs):[...new Set(paths.filter(p=>p.startsWith('steps.')).map(p=>p.split('.')[1]))].filter(id=>Object.hasOwn(run.outputs,id));},
    workflowTasks(run,step){return data.workflowKeys(run,step).map(id=>{const row=db.query('SELECT task_id FROM workflow_output_sources WHERE run_id=? AND step_id=?').get(run.id,id);if(!row)throw new Error('Unclassified legacy workflow output requires owner review.');return row.task_id;});},
    roomCheck(job,refs=sources(job.id)){
      const c=policy.context(job),room=state.conversations.find(r=>r.id===job.conversationId&&r.kind==='room');
      if(room){
        if(room.spaceId!==c.spaceId || !room.memberIds.includes(c.agentId))throw new Error('Room Space or participant mismatch.');
        for(const agentId of room.memberIds)policy.visible(agentId,c.spaceId);
      }
      if(room&&!room.memberIds.every(agentId=>refs.every(r=>policy.simulate({agentId,spaceId:c.spaceId,resourceId:r.resourceId,action:readAction(r.action)}).mode==='auto')))throw new Error('Room disclosure requires participant permission intersection.');
    },
    propose(job,outcome){data.roomCheck(job);db.query('INSERT OR IGNORE INTO room_proposal_sources VALUES(?,?,?)').run(outcome.id,job.id,proposalDigest(outcome));},
    proposal(job,outcome){
      if(!outcome)return null;
      const row=db.query('SELECT * FROM room_proposal_sources WHERE id=?').get(outcome.id);
      if(!row||proposalDigest(outcome)!==row.digest)return null;
      const taskIds=[...new Set([row.task_id,...Object.values(outcome.confirmationTasks||{}),...(outcome.reviewEvents||[]).map(review=>review.taskId)])];
      if(taskIds.some(id=>!allowed(job,id)))return null;
      try{
        for(const id of taskIds)data.roomCheck(task(id));
        const room=state.conversations.find(item=>item.id===task(row.task_id).conversationId);
        for(const record of [...(room?.evidence||[]),...(room?.cases||[]),...(room?.checkpoints||[])]){
          const sources=[record.taskId,...(record.sourceTaskIds||[])].filter(Boolean);
          for(const id of sources)data.roomCheck(task(id));
          data.assertHandoff(job,sources);if(record.exportId)data.readExport(job,record.exportId);
        }
        for(const ref of outcome.artifacts||[])data.artifact(job,room.id,ref.id,ref.versionId);
        data.assertHandoff(job,taskIds);return outcome;
      }catch{return null;}
    },
    artifact(job,roomId,artifactId,versionId){
      const c=policy.context(job),room=state.conversations.find(item=>item.id===roomId&&item.kind==='room'),artifact=room?.artifacts?.find(item=>item.id===artifactId),version=artifact?.versions.find(item=>item.id===versionId);
      if(!room||room.spaceId!==c.spaceId||!room.memberIds.includes(c.agentId)||!version)throw new Error('Deliverable access denied.');
      const taskIds=[...new Set([version.taskId,...(version.reviewEvents||[]).map(review=>review.taskId)])];
      for(const id of taskIds){if(!allowed(job,id))throw new Error('Deliverable provenance access denied.');data.roomCheck(task(id));}
      data.assertHandoff(job,taskIds);return {id:artifact.id,outputId:artifact.outputId,title:artifact.title,agentId:artifact.agentId,kind:artifact.kind,version:{...version}};
    },
    assertFileSpace(id,spaceId){const row=db.query('SELECT * FROM classified_files WHERE id=?').get(id);if(!row || row.space_id!==spaceId)throw new Error('File Space access denied.');return row;},
    file(job,id){
      const c=policy.context(job);if(!uuid(id))throw new Error('File access denied.');const row=data.assertFileSpace(id,c.spaceId);
      if(row.task_id && !allowed(job,row.task_id))throw new Error('File provenance access denied.');
      const saved=state.files.find(file=>file.id===id);
      if(saved?.exportId){const handoff=data.readExport(job,saved.exportId).roomHandoff;if(!handoff?.artifacts.some(artifact=>artifact.file?.id===id))throw new Error('File export denied.');return saved;}
      if(saved?.roomDraft&&row.task_id!==job.id){const room=state.conversations.find(item=>item.id===saved.roomDraft.roomId),artifact=room?.artifacts?.find(item=>item.versions.some(version=>version.fileId===id));if(!artifact)throw new Error('Draft has not been submitted for review.');const version=artifact.versions.find(item=>item.fileId===id);data.artifact(job,room.id,artifact.id,version.id);return saved;}
      if(saved?.roomArtifact){const ref=saved.roomArtifact,artifact=data.artifact(job,ref.roomId,ref.artifactId,ref.versionId);if(artifact.version.publishedFileId!==id)throw new Error('Deliverable publication changed.');return saved;}
      const attached=new Set([...(job.attachments||[]),...data.history(job,job.conversationId).filter(m=>m.role==='user').flatMap(m=>m.attachments||[])]);
      if(row.task_id!==job.id && !attached.has(id)){if(!row.resource_id)throw new Error('File resource grant required.');policy.authorize(job,'file.download',row.resource_id);}
      const file=state.files.find(f=>f.id===id);if(!file)throw new Error('File unavailable.');return file;
    },
    remember(job,resourceId,text){data.note(job,resourceId,'memory.write');if(typeof text!=='string'||!text.trim()||text.length>1000)throw new Error('Invalid memory.');db.query('INSERT INTO space_memory VALUES(?,?,?,?,?)').run(randomUUID(),job.spaceId,resourceId,job.id,text);},
    memory(job){const c=policy.context(job);return db.query('SELECT * FROM space_memory WHERE space_id=?').all(c.spaceId).filter(r=>{if(!allowed(job,r.task_id)||policy.simulate({agentId:c.agentId,spaceId:c.spaceId,resourceId:r.resource_id,action:'memory.read'}).mode!=='auto')return false;try{data.roomCheck(job,sources(r.task_id));return true;}catch{return false;}}).map(r=>{data.assertHandoff(job,[r.task_id]);data.note(job,r.resource_id,'memory.read');return r.text;});},
    export(input){
      if(!input||Object.keys(input).some(k=>!['messageId','destinationSpaceId','fields','purpose'].includes(k)))throw new Error('Invalid export fields.');
      if(!policy.listSpaces().some(s=>s.id===input.destinationSpaceId)||typeof input.purpose!=='string'||!input.purpose.trim()||input.purpose.length>500||!Array.isArray(input.fields)||!input.fields.length||input.fields.length>10||new Set(input.fields).size!==input.fields.length)throw new Error('Bounded export purpose and fields required.');
      const row=db.query('SELECT * FROM classified_messages WHERE id=?').get(input.messageId);if(!row)throw new Error('Export source unavailable.');
      const message=state.conversations.flatMap(c=>c.messages).find(m=>m.id===input.messageId);const original=JSON.parse(message.text);const payload={};
      for(const key of input.fields){if(typeof key!=='string'||! /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)||['constructor','prototype','__proto__'].includes(key)||!Object.hasOwn(original,key)||typeof original[key]!=='string'||original[key].length>4000)throw new Error('Export only bounded named text fields.');payload[key]=original[key];}
      const id=randomUUID();db.query('INSERT INTO data_exports VALUES(?,?,?,?,?,?,0)').run(id,row.id,digest(message.text),input.destinationSpaceId,input.purpose,JSON.stringify(payload));policy.touch();return {id,destinationSpaceId:input.destinationSpaceId,purpose:input.purpose,fields:[...input.fields]};
    },
    exportRoom(sourceRoomId,destinationSpaceId,destinationRoomId,artifacts,openQuestions=''){
      const room=state.conversations.find(item=>item.id===sourceRoomId&&item.kind==='room'),outcome=room?.discussion?.outcome;
      const message=room?.messages.findLast(item=>item.roomReport&&item.proposalId===outcome?.id);
      if(!message||room.discussion.status!=='completed'||!policy.listSpaces().some(space=>space.id===destinationSpaceId))throw new Error('A completed reviewed room is required.');
      const sourceTasks=[message.jobId,...Object.values(outcome.confirmationTasks||{}),...(outcome.reviewEvents||[]).map(review=>review.taskId),...artifacts.map(artifact=>room.artifacts.find(item=>item.id===artifact.id)?.versions.find(version=>version.id===artifact.versionId)?.taskId)].filter(Boolean);
      const upstreamIds=[...new Set(sourceTasks.flatMap(taskId=>db.query('SELECT export_id FROM task_exports WHERE task_id=?').all(taskId).map(row=>row.export_id)))];
      const upstreamExports=upstreamIds.map(id=>{const row=db.query('SELECT destination_space FROM data_exports WHERE id=?').get(id);if(!row)throw new Error('Export dependency unavailable.');validExport(row.destination_space,id);return {id,spaceId:row.destination_space};});
      const payload={roomHandoff:{sourceRoomId,proposalId:outcome.id,destinationRoomId,summary:outcome.result,decisions:outcome.nextPlan,ownerDecision:outcome.ownerDecision||null,openQuestions,artifacts,upstreamExports}};
      if(Buffer.byteLength(JSON.stringify(payload))>512*1024)throw new Error('Handoff text exceeds 512 KB.');
      const id=randomUUID();db.query('INSERT INTO data_exports VALUES(?,?,?,?,?,?,0)').run(id,message.id,roomExportDigest(room,message),destinationSpaceId,'Reviewed room handoff',JSON.stringify(payload));policy.touch();return {id,...payload};
    },
    revokeExport(id){db.query('UPDATE data_exports SET revoked=1 WHERE id=?').run(id);policy.touch();},
    readExport(job,id){const c=policy.context(job),row=validExport(c.spaceId,id),payload=JSON.parse(row.payload);if(payload.roomHandoff&&payload.roomHandoff.destinationRoomId!==job.conversationId)throw new Error('Handoff belongs to another room.');db.query('INSERT OR IGNORE INTO task_exports VALUES(?,?)').run(job.id,id);return payload;},
    issueToken(job){policy.context(job);const token=randomBytes(32).toString('base64url');db.query('INSERT INTO task_tokens VALUES(?,?,?)').run(digest(token),job.id,Date.now()+15*60*1000);return token;},
    authenticate(token){const row=db.query('SELECT * FROM task_tokens WHERE digest=? AND expires_at>?').get(digest(token),Date.now());const job=row&&state.jobs.find(j=>j.id===row.task_id);if(!job||!['running','waiting','takeover'].includes(job.status))throw new Error('Task token invalid or ended.');policy.context(job);return job;},
  };
  Object.defineProperty(state,stateData,{value:data});data.sync();return data;
}
