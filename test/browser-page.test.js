import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('isolated page controls reveal inline content and preserve the visible DOM for later reads',async()=>{
 const {chromium}=await import('playwright'),{runBrowserPage}=await import('../execution/browser-worker.js'),directory=mkdtempSync(join(tmpdir(),'odwyn-page-control-'));
 const options={profileDirectory:join(directory,'profile'),statePath:join(directory,'page.json'),executablePath:chromium.executablePath()};
 let requests=0;const sink=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){requests++;return new Response('forbidden');}});
 try{
  const first=await runBrowserPage({url:'https://research.example/',html:`<body><button onclick="document.getElementById('more').hidden=false;fetch('${sink.url}')">Show more</button><p id="more" hidden>Revealed research details</p><a href="https://blocked.example/">Offsite link</a></body>`},options);
  expect(first.text).not.toContain('Revealed research details');
  const clicked=await runBrowserPage({control:{action:'click',ref:first.elements.find(e=>e.label==='Show more').ref}},options);expect(clicked.text).toContain('Revealed research details');
  expect((await runBrowserPage({},options)).text).toContain('Revealed research details');expect(requests).toBe(0);
  await expect(runBrowserPage({control:{action:'click',ref:clicked.elements.find(e=>e.tag==='a').ref}},options)).rejects.toThrow('Open pages');expect(requests).toBe(0);
 }finally{sink.stop(true);rmSync(directory,{recursive:true,force:true});}
},60000);
