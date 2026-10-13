#!/usr/bin/env bun
import {Database} from 'bun:sqlite';
import {mkdtempSync,rmSync,existsSync,copyFileSync,chmodSync,lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {openStore} from '../store.js';
const [mode,source,...extra]=process.argv.slice(2);
if(mode!=='--dry-run'||!source||extra.length)throw new Error('Usage: bun scripts/security-migration.js --dry-run <owner-data-directory>');
const directory=resolve(source),filename=join(directory,existsSync(join(directory,'sidekick.db'))?'sidekick.db':'odwyn.db');
if(!lstatSync(filename).isFile())throw new Error('Owner database must be a regular file.');
const temporary=mkdtempSync(join(tmpdir(),'odwyn-migration-dry-run-'));chmodSync(temporary,0o700);let store,db;
try{
 // VACUUM INTO includes committed WAL records; the source is opened read-only.
 db=new Database(filename,{readonly:true});db.query('VACUUM INTO ?').run(join(temporary,'odwyn.db'));db.close();db=null;
 for(const name of ['broker.key','.env'])if(existsSync(join(directory,name))){if(!lstatSync(join(directory,name)).isFile())throw new Error('Owner secret backup must be a regular file.');copyFileSync(join(directory,name),join(temporary,name));chmodSync(join(temporary,name),0o600);}
 store=openStore(temporary);store.save();console.log(JSON.stringify({dryRun:true,sourceUnchanged:true,...store.migration.report()},null,2));
}finally{store?.close();db?.close();rmSync(temporary,{recursive:true,force:true});}
