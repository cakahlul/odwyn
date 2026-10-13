import {randomUUID,randomBytes,createHash} from 'node:crypto';

export const stateData=Symbol('server classified data');
const digest=text=>createHash('sha256').update(text).digest('hex');
const uuid=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
const readAction=action=>({'memory.write':'memory.read','repository.branch.push':'repository.read'}[action]||action);
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
  const validExport=(spaceId,id)=>{const row=db.query('SELECT * FROM data_exports WHERE id=?').get(id),message=row&&state.conversations.flatMap(c=>c.messages).find(m=>m.id===row.message_id);if(!row||row.revoked||row.destination_space!==spaceId||!message||digest(message.text)!==row.source_digest)throw new Error('Export denied, changed or revoked.');return row;};
  const allowed=(job,taskId)=>{try{
    const c=policy.context(job);if(!taskId)return true;const source=task(taskId);if(source.spaceId!==c.spaceId)return false;
    for(const row of db.query('SELECT export_id FROM task_exports WHERE task_id=?').all(taskId))validExport(c.spaceId,row.export_id);
    return sources(taskId).every(ref=>policy.simulate({agentId:source.agentId,spaceId:c.spaceId,...ref}).mode==='auto'&&policy.simulate({agentId:c.agentId,spaceId:c.spaceId,resourceId:ref.resourceId,action:readAction(ref.action)}).mode==='auto');
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
      if(conversation.kind==='room' && row.task_id){const refs=sources(row.task_id);if(!conversation.memberIds.every(agentId=>refs.every(r=>policy.simulate({agentId,spaceId:c.spaceId,resourceId:r.resourceId,action:readAction(r.action)}).mode==='auto')))return false;}
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
      if(room&&!room.memberIds.every(agentId=>refs.every(r=>policy.simulate({agentId,spaceId:c.spaceId,resourceId:r.resourceId,action:readAction(r.action)}).mode==='auto')))throw new Error('Room disclosure requires participant permission intersection.');
    },
    propose(job,outcome){data.roomCheck(job);db.query('INSERT OR IGNORE INTO room_proposal_sources VALUES(?,?,?)').run(outcome.id,job.id,digest(JSON.stringify([outcome.result,outcome.nextPlan])));},
    proposal(job,outcome){if(!outcome)return null;const row=db.query('SELECT * FROM room_proposal_sources WHERE id=?').get(outcome.id);if(!row||!allowed(job,row.task_id)||digest(JSON.stringify([outcome.result,outcome.nextPlan]))!==row.digest)return null;try{data.roomCheck(task(row.task_id));data.assertHandoff(job,[row.task_id]);return outcome;}catch{return null;}},
    assertFileSpace(id,spaceId){const row=db.query('SELECT * FROM classified_files WHERE id=?').get(id);if(!row || row.space_id!==spaceId)throw new Error('File Space access denied.');return row;},
    file(job,id){
      const c=policy.context(job);if(!uuid(id))throw new Error('File access denied.');const row=data.assertFileSpace(id,c.spaceId);
      if(row.task_id && !allowed(job,row.task_id))throw new Error('File provenance access denied.');
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
    revokeExport(id){db.query('UPDATE data_exports SET revoked=1 WHERE id=?').run(id);policy.touch();},
    readExport(job,id){const c=policy.context(job),row=validExport(c.spaceId,id);db.query('INSERT OR IGNORE INTO task_exports VALUES(?,?)').run(job.id,id);return JSON.parse(row.payload);},
    issueToken(job){policy.context(job);const token=randomBytes(32).toString('base64url');db.query('INSERT INTO task_tokens VALUES(?,?,?)').run(digest(token),job.id,Date.now()+15*60*1000);return token;},
    authenticate(token){const row=db.query('SELECT * FROM task_tokens WHERE digest=? AND expires_at>?').get(digest(token),Date.now());const job=row&&state.jobs.find(j=>j.id===row.task_id);if(!job||!['running','waiting','takeover'].includes(job.status))throw new Error('Task token invalid or ended.');policy.context(job);return job;},
  };
  Object.defineProperty(state,stateData,{value:data});data.sync();return data;
}
