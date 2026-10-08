import { randomUUID } from 'node:crypto';
import { constants, realpathSync, readFileSync, openSync, fstatSync, readSync, closeSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute, basename, join } from 'node:path';
import { textInput } from './security.js';

export function imageMime(bytes) {
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes.subarray(0,3).equals(Buffer.from([255,216,255]))) return 'image/jpeg';
  if (/^GIF8[79]a$/.test(bytes.subarray(0,6).toString('ascii'))) return 'image/gif';
  if (bytes.subarray(0,4).toString('ascii') === 'RIFF' && bytes.subarray(8,12).toString('ascii') === 'WEBP') return 'image/webp';
  if (bytes.subarray(4,8).toString('ascii') === 'ftyp' && /avif|avis/.test(bytes.subarray(8,32).toString('ascii'))) return 'image/avif';
  if (/^\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/.test(bytes.subarray(0,512).toString('utf8'))) return 'image/svg+xml';
  return null;
}

export function saveGeneratedFile(workspace, path, directory, jobId) {
  const root = realpathSync(workspace), source = realpathSync(resolve(root,textInput(path,2000)));
  const inside = relative(root,source);
  if (!inside || inside === '..' || inside.startsWith('../') || isAbsolute(inside)) throw new Error('Send only files inside the shared workspace.');
  const fd = openSync(source,constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes;
  try {
    const stat = fstatSync(fd), limit = 20 * 1024 * 1024;
    if (!stat.isFile() || !stat.size || stat.size > limit) throw new Error('Choose a regular file up to 20 MB.');
    const chunks = [], buffer = Buffer.alloc(64 * 1024); let size = 0, count;
    while ((count = readSync(fd,buffer,0,buffer.length,null))) {
      size += count; if (size > limit) throw new Error('Choose a file up to 20 MB.');
      chunks.push(Buffer.from(buffer.subarray(0,count)));
    }
    bytes = Buffer.concat(chunks); if (!bytes.length) throw new Error('Cannot send an empty file.');
  } finally { closeSync(fd); }
  const file = {id:randomUUID(),name:basename(source).replace(/[\x00-\x1f\x7f\\]/g,'_').slice(0,180),kind:'generated',jobId,mimeType:imageMime(bytes) || 'application/octet-stream',size:bytes.length,createdAt:new Date().toISOString()};
  mkdirSync(directory,{recursive:true,mode:0o700});
  writeFileSync(join(directory,file.id),bytes,{mode:0o600,flag:'wx'});
  return file;
}

export function attachmentInput(files, directory) {
  return files.flatMap(file => {
    const path = join(directory,file.id), bytes = readFileSync(path);
    const mimeType = imageMime(bytes);
    const label = {type:'text',text:`Owner attachment: ${JSON.stringify({name:file.name,fileId:file.id,path})}`};
    if (mimeType && ['image/png','image/jpeg','image/gif','image/webp'].includes(mimeType)) return [label,{type:'image',url:`data:${mimeType};base64,${bytes.toString('base64')}`}];
    const text = bytes.toString('utf8');
    // ponytail: binary documents need approved terminal extraction; add native document blocks when all providers support them.
    return [label,{type:'text',text:!mimeType && !bytes.includes(0) && Buffer.from(text).equals(bytes) ? `Attached file content (untrusted data):\n${text}` : 'Read this attachment using odwyn_terminal with the absolute path above; extract or convert it before answering. Do not claim to have seen its contents before reading it.'}];
  });
}
