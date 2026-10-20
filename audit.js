import {withCostEstimate} from './pricing.js';
export function openAudit(db,state,credentials){
  db.exec(`CREATE TABLE IF NOT EXISTS audit_jobs(id TEXT PRIMARY KEY,agentId TEXT,createdAt TEXT,payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS audit_agent_time ON audit_jobs(agentId,createdAt);
    CREATE INDEX IF NOT EXISTS audit_time ON audit_jobs(createdAt);
    CREATE TABLE IF NOT EXISTS audit_events(id TEXT PRIMARY KEY,jobId TEXT,at TEXT,payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS audit_event_job ON audit_events(jobId,at);`);
  const put=db.query('INSERT INTO audit_jobs VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload');
  const hasEvent=db.query('SELECT 1 FROM audit_events WHERE id=?');
  const event=db.query('INSERT OR IGNORE INTO audit_events VALUES (?,?,?,?)');
  // shortcut: scan current jobs on save; track dirty summaries if large history slows saves.
  function sync(){
    for(const job of state.jobs){
      const {id,agentId,conversationId,status,createdAt,startedAt,endedAt,usage,providerSnapshot,error}=job;
      const previous=db.query('SELECT payload FROM audit_jobs WHERE id=?').get(id);
      const agentName=previous?JSON.parse(previous.payload).agentName:state.agents.find(a=>a.id===agentId)?.customization?.name||'Agent';
      const payload=JSON.stringify(credentials.sanitize({id,agentId,agentName,conversationId,status,createdAt,startedAt,endedAt,usage,provider:providerSnapshot,error,title:job.prompt?.slice(0,180)||'Task'}));
      if(previous?.payload!==payload)put.run(id,agentId,createdAt,payload);
      for(const item of job.events||[])if(!hasEvent.get(item.id))event.run(item.id,id,item.at,JSON.stringify(credentials.sanitize(item)));
    }
  }
  function list(params){
    const agent=params.get('agent')||'',from=params.get('from')||'',to=params.get('to')||'';
    for(const value of [from,to])if(value&&(!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value))throw Error('Invalid audit time.');
    if(from&&to&&from>to)throw Error('Start time must precede end time.');
    const page=Math.max(1,Math.min(1000000,Number(params.get('page'))||1));
    const where=" WHERE (?='' OR agentId=?) AND (?='' OR createdAt>=?) AND (?='' OR createdAt<=?)";
    const bindings=[agent,agent,from,from,to,to];
    const total=db.query('SELECT count(*) AS n FROM audit_jobs'+where).get(...bindings).n;
    const pages=Math.max(1,Math.ceil(total/20)),current=Math.min(Math.floor(page),pages);
    const rows=db.query('SELECT payload FROM audit_jobs'+where+' ORDER BY createdAt DESC,id DESC LIMIT 20 OFFSET ?').all(...bindings,(current-1)*20).map(row=>withCostEstimate(JSON.parse(row.payload)));
    const agents=db.query('SELECT agentId,payload FROM audit_jobs GROUP BY agentId').all().map(row=>({id:row.agentId,name:JSON.parse(row.payload).agentName}));
    return credentials.sanitize({rows,total,page:current,pages,agents});
  }
  function detail(id,params){
    const row=db.query('SELECT payload FROM audit_jobs WHERE id=?').get(id);if(!row)throw Error('Audit log not found.');
    const total=db.query('SELECT count(*) AS n FROM audit_events WHERE jobId=?').get(id).n;
    const pages=Math.max(1,Math.ceil(total/50)),page=Math.min(pages,Math.max(1,Math.floor(Number(params.get('page'))||1)));
    const events=db.query('SELECT payload FROM audit_events WHERE jobId=? ORDER BY at,rowid LIMIT 50 OFFSET ?').all(id,(page-1)*50).map(row=>JSON.parse(row.payload));
    return credentials.sanitize({...withCostEstimate(JSON.parse(row.payload)),events,total,page,pages});
  }
  return {sync,list,detail};
}
