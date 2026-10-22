import {randomUUID,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {existsSync,writeFileSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';

export function openCredentials(db,directory){
  db.exec('CREATE TABLE IF NOT EXISTS provider_credentials(id TEXT PRIMARY KEY,slot TEXT NOT NULL,type TEXT NOT NULL,credential TEXT NOT NULL)');
  const keyPath=join(directory,'broker.key');
  function key(){if(!existsSync(keyPath)){if(db.query('SELECT 1 FROM provider_credentials LIMIT 1').get())throw new Error('Credential key unavailable; restore the owner backup.');writeFileSync(keyPath,randomBytes(32),{mode:0o600,flag:'wx'});}const stat=statSync(keyPath);if(!stat.isFile()||(stat.mode&0o077))throw new Error('Credential key permissions invalid.');const bytes=readFileSync(keyPath);if(bytes.length!==32)throw new Error('Credential key unavailable.');return bytes;}
  function binding(row){return row.id+':'+row.slot+':'+row.type;}
  function encrypt(secret,row){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);cipher.setAAD(Buffer.from(binding(row)));const encrypted=Buffer.concat([cipher.update(secret),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64');}
  function decrypt(row){const bytes=Buffer.from(row.credential,'base64'),cipher=createDecipheriv('aes-256-gcm',key(),bytes.subarray(0,12));cipher.setAAD(Buffer.from(binding(row)));cipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString();}
  if(db.query("SELECT name FROM sqlite_master WHERE name='security_meta'").get()){
    const owner=db.query('SELECT owner_id FROM security_meta WHERE id=1').get()?.owner_id;
    for(const row of db.query('SELECT * FROM provider_credentials').all()){
      const bytes=Buffer.from(row.credential,'base64'),cipher=createDecipheriv('aes-256-gcm',key(),bytes.subarray(0,12));
      cipher.setAAD(Buffer.from(row.id+':'+owner+':'+row.slot+':'+row.type));cipher.setAuthTag(bytes.subarray(12,28));
      const secret=Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString();
      db.query('UPDATE provider_credentials SET credential=? WHERE id=?').run(encrypt(secret,row),row.id);
    }
  }
  const secretsFor=row=>{
    const decrypted=decrypt(row);if(!row.slot.startsWith('connection/'))return [decrypted];
    const config=JSON.parse(decrypted),headers=Object.values(config.headers||{});
    const auth=Object.entries(config.headers||{}).find(([name])=>name.toLowerCase()==='authorization')?.[1]||'';
    const bearer=auth.match(/^Bearer (.+)$/i)?.[1],basic=auth.match(/^Basic (.+)$/i)?.[1];
    const password=basic?Buffer.from(basic,'base64').toString().split(':').slice(1).join(':'):undefined;
    return [...headers,...Object.values(config.env||{}),bearer,password,config.oauth?.tokens?.access_token,config.oauth?.tokens?.refresh_token,config.oauth?.client?.client_secret,config.oauth?.verifier].filter(value=>typeof value==='string'&&value);
  };
  const providers=state=>[['workspace',state.provider],['global',state.globalProvider],...state.agents.map(a=>['agent/'+a.id,a.provider]),...(state.connections||[]).map(c=>['connection/'+c.id,c])].filter(([,config])=>config);
  function redactor(){
    // Read current secrets once per operation, including credential key validation.
    const variants=db.query('SELECT * FROM provider_credentials').all().flatMap(row=>secretsFor(row).flatMap(secret=>[...new Set([secret,JSON.stringify(secret).slice(1,-1),encodeURIComponent(secret),Buffer.from(secret).toString('base64')])]));
    return text=>{let result=String(text);for(const variant of variants)result=result.replaceAll(variant,'[REDACTED]');return result;};
  }
  return {
    hydrateProviders(state){for(const [slot,config] of providers(state)){if(!config.credentialRef)continue;const row=db.query('SELECT * FROM provider_credentials WHERE id=? AND slot=? AND type=?').get(config.credentialRef,slot,config.type);if(!row)throw new Error('Provider credential reference unavailable.');config.apiKey=decrypt(row);delete config.credentialRef;}},
    serialize(state){const saved=JSON.parse(JSON.stringify(state));for(const [slot,config] of providers(saved)){if(!config.apiKey)continue;let row=db.query('SELECT * FROM provider_credentials WHERE slot=? AND type=?').all(slot,config.type).find(r=>decrypt(r)===config.apiKey);if(!row){row={id:randomUUID(),slot,type:config.type};row.credential=encrypt(config.apiKey,row);db.query('INSERT INTO provider_credentials VALUES(?,?,?,?)').run(row.id,slot,row.type,row.credential);}config.credentialRef=row.id;delete config.apiKey;}return JSON.stringify(saved);},
    redact(text){return redactor()(text);},
    sanitize(value){
      const redact=redactor();
      const visit=value=>{if(typeof value==='string')return redact(value);if(Array.isArray(value))return value.map(visit);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[redact(k),visit(v)]));return value;};
      return visit(value);
    },
    assertNoSecret(bytes){const text=bytes.toString('utf8');if(this.redact(text)!==text)throw new Error('Protected credential material cannot be exported.');},
  };
}
