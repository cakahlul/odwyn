import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, truncateSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveGeneratedFile, imageMime } from '../files.js';

test('generated files preserve bytes, detect images, and cannot publish outside the workspace', () => {
  const dir = mkdtempSync(join(tmpdir(),'odwyn-files-')), workspace = join(dir,'workspace'), destination = join(dir,'files');
  mkdirSync(workspace);
  try {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=','base64');
    writeFileSync(join(workspace,'answer.png'),png);
    const file = saveGeneratedFile(workspace,'answer.png',destination,'job');
    expect(file.kind).toBe('generated'); expect(file.name).toBe('answer.png'); expect(file.mimeType).toBe('image/png');
    expect(readFileSync(join(destination,file.id))).toEqual(png);
    writeFileSync(join(dir,'private.txt'),'secret'); symlinkSync(join(dir,'private.txt'),join(workspace,'escape'));
    for (const path of ['../private.txt','escape',workspace]) expect(()=>saveGeneratedFile(workspace,path,destination,'job')).toThrow();
    writeFileSync(join(workspace,'empty'),''); expect(()=>saveGeneratedFile(workspace,'empty',destination,'job')).toThrow();
    writeFileSync(join(workspace,'large'),'x'); truncateSync(join(workspace,'large'),20*1024*1024+1);
    expect(()=>saveGeneratedFile(workspace,'large',destination,'job')).toThrow('20 MB');
    expect(imageMime(Buffer.from('<html>unsafe</html>'))).toBe(null);
    writeFileSync(join(workspace,'fake.png'),'<html>unsafe</html>');
    expect(saveGeneratedFile(workspace,'fake.png',destination,'job').mimeType).toBe('application/octet-stream');
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
