import {ScopedBrowsers} from '../../security/scoped-browser.js';
import {runnerEnvironment,SecurityEnvironmentBlocked} from './phase2/fixture.js';

export async function isolatedBrowsers(store,resolver){
  await runnerEnvironment();
  const image=process.env.ODWYN_SECURITY_BROWSER_IMAGE;
  if(!/^sha256:[a-f0-9]{64}$/.test(image||''))throw new SecurityEnvironmentBlocked('Pinned disposable browser image required.');
  const browsers=new ScopedBrowsers(store,{image,resolver});
  if((await browsers.executor.docker(['image','inspect',image])).exitCode!==0)throw new SecurityEnvironmentBlocked('Pinned disposable browser image unavailable.');
  store.security.configureBrowser(browsers.configured);
  return browsers;
}

// Trusted fixture driver runs inside the same isolated container/profile as Chromium.
// No agent tool accepts code or receives this driver interface.
export async function browserProbe(browsers,job,resourceId,run,input){
  const worker=browsers.get(job,resourceId);
  const source=`import {openBrowserPage,closeBrowserPage} from '/app/execution/browser-worker.js';
    const {context,page}=await openBrowserPage();
    try{console.log(JSON.stringify(await (${run.toString()})({context,page,input:${JSON.stringify(input??null)}})));}
    finally{await closeBrowserPage(context);}`;
  const result=await browsers.executor.inside(worker,['bun','--eval',source],{timeoutMs:20000,limit:131072});
  if(result.exitCode!==0||result.truncated)throw new Error('Disposable browser probe failed.');
  return JSON.parse(result.stdout.toString());
}
