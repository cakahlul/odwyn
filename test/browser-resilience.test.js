import {test,expect} from 'bun:test';
import {Browser} from '../browser.js';
function fixture(){
 const browser=new Browser({directory:'/tmp/odwyn-browser-resilience'});let closed=false;
 const page={isClosed:()=>closed,url:()=>'https://example.com/',title:async()=>'Example'};
 browser.context={pages:()=>[page],close:async()=>{closed=true;browser.context=null;browser.page=null;}};browser.page=page;
 return {browser,page,closed:()=>closed};
}
test('preview failures neither close the live browser nor block the action queue',async()=>{
 const {browser,page,closed}=fixture();
 page.screenshot=options=>new Promise((_,reject)=>{setTimeout(()=>reject(new Error('screenshot timed out')),options?.timeout?20:200);});
 const serial=browser.serial.bind(browser);browser.serial=fn=>serial(fn,40);
 const pending=browser.frame().catch(error=>({error:error.message}));
 let acted=false;const action=browser.serial(()=>{acted=true;});await Bun.sleep(0);
 expect(acted).toBe(true);await action;const frame=await pending;
 expect(closed()).toBe(false);expect(frame.error).toBeTruthy();await browser.close();
});
test('overlapping preview requests share one capture and discard frames from a replaced page',async()=>{
 const {browser,page}=fixture();let release,captures=0;
 const image=new Promise(resolve=>{release=resolve;});page.screenshot=()=>{captures++;return image;};
 const requests=Array.from({length:12},()=>browser.frame());await Bun.sleep(0);
 browser.page={...page,url:()=>'https://other.example/'};release(Buffer.from('image'));
 expect((await Promise.all(requests)).every(frame=>frame===null)).toBe(true);
 expect(captures).toBe(1);await browser.close();
});
test('unresponsive preview capture releases polling and allows a fresh capture',async()=>{
 const {browser,page}=fixture();page.screenshot=()=>new Promise(()=>{});
 const started=Date.now();const frame=await browser.frame();
 expect(frame.error).toBeTruthy();expect(Date.now()-started).toBeLessThan(4000);
 page.screenshot=async()=>Buffer.from('fresh');
 expect((await browser.frame()).image).toBe(Buffer.from('fresh').toString('base64'));
 await browser.close();
},5000);
