import {test,expect} from 'bun:test';
import {chromium} from 'playwright';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server.js';
import {defaults} from '../public/profile.js';
import {newPageWithoutTutorials} from '../tests/browser-page.js';

test('separate workflow and skill pages search and paginate catalogs and complete run histories',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-libraries-'));let app;
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
  app=createApp({directory,user:'owner',password:'test-password-long-enough',origin:server.url.origin,codex:Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}}),browser:{close:async()=>{}}});
  const state=app.runtime.state,at=new Date().toISOString(),agentId=state.agents[0].id;
  state.customization={...defaults};state.globalProvider.configured=true;
  for(let index=0;index<35;index++){
    const workflow={id:randomUUID(),name:`Process ${index}`,command:`process-${index}`,description:'Prepare reports',steps:[],inputs:[]};
    const skill={id:randomUUID(),name:`Skill ${index}`,command:`skill-${index}`,description:'Review code',instructions:'Review code.'};
    const jobId=randomUUID(),conversationId=randomUUID();
    state.workflows.push(workflow);state.skills.push(skill);
    state.workflowRuns.push({id:randomUUID(),workflow,createdAt:at,status:'completed',visits:1,currentStep:'done',conversationId,inputs:{},outputs:{}});
    state.conversations.push({id:conversationId,agentId,title:`Skill chat ${index}`,createdAt:at,messages:[{id:randomUUID(),jobId,role:'user',text:`/${skill.command} check`,at}]});
    state.jobs.push({id:jobId,agentId,conversationId,createdAt:at,status:'completed',prompt:'Review code.',events:[],files:[],...(index===34?{skill:{...skill,name:'Archived skill'}}:{})});
  }
  app.runtime.changed();
  const browser=await chromium.launch(),page=await newPageWithoutTutorials(browser,{httpCredentials:{username:'owner',password:'test-password-long-enough'},viewport:{width:1440,height:960}}),errors=[];
  page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));
  const artifacts=join(import.meta.dir,'../artifacts/ui/libraries');mkdirSync(artifacts,{recursive:true});
  try{
    await page.goto(server.url.href+'#workflows');
    await page.getByRole('heading',{name:'Workflows',exact:true}).waitFor();
    expect(await page.locator('[data-skill-new]').count()).toBe(0);
    expect(await page.locator('[data-workflow-template]').count()).toBe(0);
    expect(await page.getByText('Odwyn workspace',{exact:true}).count()).toBe(0);
    expect(await page.locator('[data-workflow-edit]').count()).toBe(10);
    await page.locator('#workflowRuns-search').fill('Process 34');
    expect(await page.locator('[data-workflow-history]').count()).toBe(1);
    await page.locator('[data-workflow-history]').click();await page.locator('#workflow-history[open]').waitFor();
    await page.locator('[data-history-close]').click();
    await page.locator('#workflowRuns-search').fill('');
    for(let pageNumber=0;pageNumber<3;pageNumber++)await page.locator('[data-library-page=workflowRuns]').getByText('Next',{exact:true}).click();
    expect(await page.locator('[data-workflow-history]').count()).toBe(5);
    await page.locator('#workflowRuns-search').fill('missing');
    expect(await page.locator('[aria-labelledby=workflowRuns-title] .workflow-empty').textContent()).toContain('No matches');
    await page.locator('#workflowRuns-search').fill('completed');
    expect(await page.locator('[data-workflow-history]').count()).toBe(10);
    await page.locator('#view').evaluate(node=>node.scrollTop=0);await page.screenshot({path:join(artifacts,'workflows.png'),fullPage:true});
    await page.locator('#tools-open').click();await page.locator('[data-view=skills]').click();
    await page.getByRole('heading',{name:'Skills',exact:true}).waitFor();expect(await page.locator('[data-workflow-new]').count()).toBe(0);
    expect(await page.locator('[data-skill-edit]').count()).toBe(10);
    await page.locator('[data-library-page=skills]').getByText('Next',{exact:true}).click();
    expect(await page.getByRole('heading',{name:'Skill 10',exact:true}).count()).toBe(1);
    await page.locator('#skills-search').fill('Skill 34');expect(await page.locator('[data-skill-edit]').count()).toBe(1);
    await page.locator('#skillRuns-search').fill('Archived skill');
    expect(await page.locator('[aria-labelledby=skillRuns-title] .workflow-row').count()).toBe(1);
    await page.locator('#skillRuns-search').fill('');
    for(let pageNumber=0;pageNumber<3;pageNumber++)await page.locator('[data-library-page=skillRuns]').getByText('Next',{exact:true}).click();
    expect(await page.locator('[aria-labelledby=skillRuns-title] .workflow-row').count()).toBe(5);
    await page.locator('[data-skill-new]').click();
    await page.locator('#skill-form [name=name]').fill(' skill 0 ');await page.locator('#skill-form [name=command]').fill('unique-command');await page.locator('#skill-form [name=instructions]').fill('Check sources.');
    await page.getByRole('button',{name:'Save skill',exact:true}).click();
    await page.locator('#skill-error').filter({hasText:'Skill name already exists.'}).waitFor();expect(state.skills).toHaveLength(35);
    await page.locator('[data-skill-close]').click();await page.screenshot({path:join(artifacts,'skills.png'),fullPage:true});
    for(const width of [320,768,1024,1440]){
      await page.setViewportSize({width,height:900});
      expect(await page.locator('#view').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
    }
    await page.reload();await page.getByRole('heading',{name:'Skills',exact:true}).waitFor();
    expect(errors).toEqual([]);
  }finally{await browser.close();server.stop(true);await app.close();rmSync(directory,{recursive:true,force:true});}
},30_000);
