import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync,rmSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {openCredentials} from '../credentials.js';

test('sanitizing nested state loads credentials once and refreshes secrets between calls',()=>{
  const directory=mkdtempSync('/tmp/odwyn-credentials-'),db=new Database(':memory:');
  let reads=0;
  const broker=openCredentials({exec:sql=>db.exec(sql),query(sql){if(sql==='SELECT * FROM provider_credentials')reads++;return db.query(sql);}},directory);
  const state={agents:[],provider:{type:'openai',apiKey:'private / secret'}};
  try{
    broker.serialize(state);reads=0;
    const variants=[state.provider.apiKey,encodeURIComponent(state.provider.apiKey),Buffer.from(state.provider.apiKey).toString('base64')];
    const input={nested:Array.from({length:100},()=>Object.fromEntries(variants.map(secret=>[secret,secret])))};
    expect(broker.sanitize(input)).toEqual({nested:Array.from({length:100},()=>({'[REDACTED]':'[REDACTED]'}))});
    expect(reads).toBe(1);
    state.provider.apiKey='replacement-secret';broker.serialize(state);
    expect(broker.sanitize(['replacement-secret','private / secret'])).toEqual(['[REDACTED]','[REDACTED]']);
    chmodSync(join(directory,'broker.key'),0o644);
    expect(()=>broker.sanitize({text:'replacement-secret'})).toThrow('Credential key permissions invalid.');
  }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});
