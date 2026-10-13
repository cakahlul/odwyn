import {Database} from 'bun:sqlite';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {openStore} from '../../../store.js';
import {fixture} from './fixture.js';
const [mode,directory]=process.argv.slice(2);
if(mode==='migration'){
 const exec=Database.prototype.exec;
 Database.prototype.exec=function(sql,...args){const result=exec.call(this,sql,...args);if(sql.includes('CREATE TABLE security_meta(')){writeFileSync(join(directory,'migration-in-transaction'),'ready');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}return result;};
 openStore(directory);throw new Error('Migration interruption barrier was not reached');
}else if(mode==='recovery'){
 const f=fixture({directory,afterEffect(body,key){writeFileSync(join(directory,'upstream-effect.json'),JSON.stringify({effects:1,body,key}));process.kill(process.pid,'SIGSTOP');}});
 const x=f.resources()[0];f.grant([[x.r,x.action]]);const j=f.job(),args={resourceId:x.r.id,action:x.action,parameters:x.parameters},id=f.pending(await f.invoke(j,'odwyn_action',args));await f.approve(id);f.store.save();
 writeFileSync(join(directory,'recovery-binding.json'),JSON.stringify({jobId:j.id,approvalId:id,args}));await f.invoke(j,'odwyn_action',{...args,approvalId:id});throw new Error('Crash barrier was not reached');
}else throw new Error('Unknown disposable child mode');
