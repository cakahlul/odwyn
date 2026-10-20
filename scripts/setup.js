import {existsSync,mkdirSync,writeFileSync,lstatSync,chmodSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {resolve,join} from 'node:path';

export async function setup(root,{log=console.log}={}){
  root=resolve(root);const file=join(root,'.env');
  if(existsSync(file)&&!lstatSync(file).isFile())throw Error('Setup requires a regular .env file.');
  if(!existsSync(file))writeFileSync(file,`ODWYN_USER=owner\nODWYN_PASSWORD=${randomBytes(24).toString('base64url')}\nPORT=4317\nODWYN_ORIGIN=\n`,{mode:0o600,flag:'wx'});
  chmodSync(file,0o600);mkdirSync(join(root,'data'),{recursive:true,mode:0o700});
  log('Ready. Credentials are in .env. Run bun start, then configure your AI provider in Settings.');
}
if(import.meta.main)await setup(resolve(import.meta.dir,'..'));
