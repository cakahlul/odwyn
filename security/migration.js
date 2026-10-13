import {mkdtempSync,chmodSync,existsSync,copyFileSync,lstatSync,readdirSync} from 'node:fs';
import {join} from 'node:path';

export function securityBackup(db,directory,prefix){
 const backup=mkdtempSync(join(directory,prefix));chmodSync(backup,0o700);
 db.query('VACUUM INTO ?').run(join(backup,'state.sqlite'));chmodSync(join(backup,'state.sqlite'),0o600);
 for(const name of ['.env','broker.key'])if(existsSync(join(directory,name))){if(!lstatSync(join(directory,name)).isFile())throw new Error('Security backup requires regular owner files.');copyFileSync(join(directory,name),join(backup,name));chmodSync(join(backup,name),0o600);}
 return backup;
}
export function openMigration(db,state,directory){
 db.exec('CREATE TABLE IF NOT EXISTS security_migration(id INTEGER PRIMARY KEY CHECK(id=1),reviewed_at TEXT)');
 db.query('INSERT OR IGNORE INTO security_migration VALUES(1,NULL)').run();
 const report=()=>({version:1,safeRestriction:true,reviewRequired:!db.query('SELECT reviewed_at FROM security_migration WHERE id=1').get().reviewed_at,agents:state.agents.length,conversations:state.conversations.length,routines:state.schedules.length,workflows:state.workflows.length,interruptedTasks:state.jobs.filter(j=>j.status==='interrupted').length,backupAvailable:readdirSync(directory).some(n=>/^pre-(?:security|data-security|approval-security)-/.test(n)&&existsSync(join(directory,n,'state.sqlite'))),restrictions:['Legacy interaction modes grant no resource access.','Review each agent and exact Space/resource/action in Access & Autonomy.','Unsafe imported workflow actions remain denied; interrupted runs require owner review.','Terminal execution requires the isolated backend; never a host-shell fallback.']});
 return {report,review(input){if(!input||Object.keys(input).length!==1||input.reviewed!==true)throw new Error('Explicit migration review required.');db.query('UPDATE security_migration SET reviewed_at=? WHERE id=1').run(new Date().toISOString());return report();}};
}
