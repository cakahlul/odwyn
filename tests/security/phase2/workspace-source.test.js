import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture,script} from './fixture.js';
import {Sandbox} from '../../../execution/sandbox.js';
import {workspaceSource,importWorkspaceSource} from '../../../execution/workspace-source.js';

test('imported named workspace runs in a real isolated worker without changing its source folder',async()=>{
  const f=await fixture();let sandbox;
  try{
    const p=f.store.security,root=join(f.directory,'ui-sources');
    const resource=p.createResource({spaceId:f.job.spaceId,type:'workspace',name:'Imported project',metadata:{sourceFolder:'product/backend'}});
    p.putAccess(f.job.agentId,{revision:p.revision,spaceIds:[f.job.spaceId],grants:[{spaceId:f.job.spaceId,resourceId:resource.id,action:'sandbox.exec',mode:'auto',constraints:{}}]});
    workspaceSource(root,resource.metadata.sourceFolder,{create:true});
    await importWorkspaceSource(root,resource.metadata.sourceFolder,[new File(['console.log("Imported source works");'],'src/main.js'),new File(['excluded'],'.env')]);
    sandbox=new Sandbox(p,{image:process.env.ODWYN_SECURITY_SANDBOX_IMAGE,snapshotRoot:root,checkpointRoot:join(f.directory,'import-checkpoints')});
    const result=await sandbox.run(f.job,{resourceId:resource.id,command:'bun src/main.js',reason:'Verify imported source',timeoutMs:5000});
    expect(result.exitCode).toBe(0);expect(result.stdout).toContain('Imported source works');
    const edit=await sandbox.run(f.job,{resourceId:resource.id,command:script('const fs=require("node:fs");if(fs.existsSync(".env"))throw Error("secret copied");fs.writeFileSync("src/main.js","changed inside worker");'),reason:'Verify private copy',timeoutMs:5000});
    expect(edit.exitCode).toBe(0);expect(readFileSync(join(root,'product/backend/src/main.js'),'utf8')).toContain('Imported source works');
    const checkpoint=await sandbox.checkpoint(f.job,resource.id);expect(checkpoint.files.find(file=>file.path==='src/main.js').data).toBe(Buffer.from('changed inside worker').toString('base64'));
  }finally{await sandbox?.close();await f.close();}
},60000);
