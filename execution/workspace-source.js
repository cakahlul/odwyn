import {lstatSync,mkdirSync,readdirSync,realpathSync,mkdtempSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';

export const sourceLimits=Object.freeze({bytes:16*1024*1024,entries:4096});
export function sourceFolder(value){
  if(typeof value!=='string'||!value.length||value.length>512||/[\x00-\x1f\x7f\\]/.test(value)||value.startsWith('/')||value.split('/').some(part=>!part||part==='.'||part==='..'||part.startsWith('.')))throw new Error('Use a relative source folder inside the displayed source root; no absolute paths, hidden folders or traversal.');
  return value;
}
export function workspaceSource(root,folder,{create=false}={}){
  sourceFolder(folder);
  if(!root)return {sourceRoot:null,sourceFolder:folder,path:null,exists:false};
  root=resolve(root);
  const directory=path=>{let stat;try{stat=lstatSync(path);}catch(error){if(error.code!=='ENOENT')throw error;if(!create)return false;mkdirSync(path,{mode:0o700});stat=lstatSync(path);}if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Source folders must be real directories, without symbolic links.');return true;};
  // Trusted root is server-owned; every resource-controlled component rejects symlinks.
  if(create)mkdirSync(dirname(root),{recursive:true,mode:0o700});
  if(!directory(root))return {sourceRoot:root,sourceFolder:folder,path:join(root,folder),exists:false};
  const canonical=realpathSync(root);let path=root;
  for(const part of folder.split('/')){path=join(path,part);if(!directory(path))return {sourceRoot:canonical,sourceFolder:folder,path:join(root,folder),exists:false};}
  return {sourceRoot:canonical,sourceFolder:folder,path,exists:true,empty:readdirSync(path).length===0};
}
const excluded=new Set(['.git','node_modules','dist','build','coverage','.next','.env','.ssh','.aws','.codex','.docker','.npmrc','.gitconfig','.git-credentials','.netrc','auth.json','Cookies','state.sqlite','odwyn.db','odwyn.db-wal','odwyn.db-shm','sidekick.db','sidekick.db-wal','sidekick.db-shm','id_rsa','id_ed25519']);
export function excludedSourceFile(path){return path.split('/').some(part=>excluded.has(part)||part.startsWith('.env.')||/\.(pem|key)$/i.test(part));}
function filePath(value){
  if(typeof value!=='string'||!value||Buffer.byteLength(value)>4096||/[\x00-\x1f\x7f\\]/.test(value)||value.startsWith('/')||value.split('/').some(part=>!part||part==='.'||part==='..')||value.split('/').length>33)throw new Error('Import contains an unsafe source file path.');
  return value;
}
export async function importWorkspaceSource(root,folder,files,{assertBytes=()=>{},beforeWrite=()=>{}}={}){
  if(!Array.isArray(files)||!files.length||files.length>sourceLimits.entries)throw new Error('Choose up to 4,096 source files.');
  const prepared=[],paths=new Set();let bytes=0,skipped=0;
  for(const file of files){
    const path=filePath(file.name);if(excludedSourceFile(path)){skipped++;continue;}
    if(paths.has(path))throw new Error('Import contains duplicate source file paths.');paths.add(path);
    if(bytes+file.size>sourceLimits.bytes)throw new Error('Source files exceed 16 MiB. Dependencies and build outputs belong outside the source import.');
    const content=Buffer.from(await file.arrayBuffer());bytes+=content.length;if(bytes>sourceLimits.bytes)throw new Error('Source files exceed 16 MiB.');assertBytes(content);prepared.push({path,content});
  }
  if(!prepared.length)throw new Error('No source files to import after excluding credentials, Git history, dependencies and build outputs.');
  beforeWrite();const source=workspaceSource(root,folder);
  if(!source.exists||!source.empty)throw new Error('Import requires an empty source folder. Create a fresh workspace resource to preserve existing code.');
  const temporary=mkdtempSync(join(dirname(source.path),'.import-'));
  try{
    const directories=new Set();
    for(const file of prepared){for(let parent=dirname(file.path);parent!=='.';parent=dirname(parent))directories.add(parent);}
    if(directories.size+prepared.length>sourceLimits.entries)throw new Error('Source files and folders exceed 4,096 entries.');
    for(const file of prepared){const target=join(temporary,file.path);mkdirSync(dirname(target),{recursive:true,mode:0o700});writeFileSync(target,file.content,{flag:'wx',mode:0o600});}
    beforeWrite();const current=workspaceSource(root,folder);if(!current.empty)throw new Error('Source folder changed during import.');
    renameSync(temporary,source.path);
    return {files:prepared.length,bytes,skipped,workspaceSource:workspaceSource(root,folder)};
  }finally{rmSync(temporary,{recursive:true,force:true});}
}
