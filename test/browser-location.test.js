import {test,expect} from 'bun:test';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Browser} from '../browser.js';
import {createApp} from '../server.js';

test('owner location applies globally when remembered, scopes temporary grants, and clears overrides',async()=>{
  const calls=[],browser=new Browser({directory:'/tmp/unused-location-test'});
  browser.start=async()=>{};
  browser.page={url:()=> 'https://example.com/map'};
  browser.context={clearPermissions:async()=>calls.push('clear'),setGeolocation:async value=>calls.push(value),grantPermissions:async(...args)=>calls.push(args)};
  const location={latitude:-6.2,longitude:106.8};
  await browser.setLocation(location,true);
  expect(calls).toEqual(['clear',location,[['geolocation'],undefined]]);
  calls.length=0;await browser.setLocation(location,false);
  expect(calls).toEqual(['clear',location,[['geolocation'],{origin:'https://example.com'}]]);
  calls.length=0;await browser.setLocation(null);
  expect(calls).toEqual(['clear',null]);
  calls.length=0;
  await expect(browser.setLocation(location,true,()=>false)).rejects.toThrow('Take browser control');
  expect(calls).toEqual([]);
  browser.page.url=()=> 'about:blank';
  await expect(browser.setLocation(location,false)).rejects.toThrow('HTTPS');
  expect(calls).toEqual([]);
  expect(()=>browser.setLocation({latitude:91,longitude:0},true)).toThrow();
});

test('owner location requires takeover, validates input, survives reopening, and clears saved coordinates',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-location-api-')),calls=[];
  const browser={close:async()=>{},setLocation:async(...args)=>calls.push(args)};
  const options={directory,user:'owner',password:'test-password-long-enough',origin:'https://assistant.test',browser,codex:Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}})};
  let app=createApp(options);
  const request=(body,authorized=true)=>app.fetch(new Request(options.origin+'/api/browser/location',{method:'POST',headers:{'content-type':'application/json',origin:options.origin,...(authorized?{authorization:'Basic '+Buffer.from('owner:test-password-long-enough').toString('base64')}:{})},body:JSON.stringify(body)}));
  const location={latitude:-6.2,longitude:106.8};
  try{
    expect((await request({location,remember:true},false)).status).toBe(401);
    expect((await request({location,remember:true})).status).toBe(409);
    await app.runtime.setTakeover(true);
    for(const body of [{location:{latitude:91,longitude:0},remember:true},{location,remember:'yes'},{location:{latitude:0},remember:false}])expect((await request(body)).status).toBe(400);
    expect(calls).toHaveLength(0);
    expect((await request({location,remember:true})).status).toBe(200);
    expect(app.runtime.state.browserLocation).toEqual(location);
    await app.close();app=createApp(options);
    expect(app.runtime.state.browserLocation).toEqual(location);
    await app.runtime.setTakeover(true);
    browser.setLocation=async()=>{throw new Error('Browser unavailable');};
    expect((await request({location:null,remember:false})).status).toBe(400);
    expect(app.runtime.state.browserLocation).toEqual(location);
    browser.setLocation=async(...args)=>calls.push(args);
    expect((await request({location:null,remember:false})).status).toBe(200);
    await app.close();app=createApp(options);
    expect(app.runtime.state.browserLocation).toBeNull();
  }finally{await app.close();rmSync(directory,{recursive:true,force:true});}
});

test('agent location action scopes permission to the requested origin before navigation',async()=>{
  const calls=[],browser=new Browser({directory:'/tmp/unused-agent-location-test'});
  browser.start=async()=>{};
  browser.page={isClosed:()=>false};
  browser.snapshot=async()=>({url:'about:blank'});
  browser.context={clearPermissions:async()=>calls.push('clear'),setGeolocation:async value=>calls.push(value),grantPermissions:async(...args)=>calls.push(args)};
  await browser.action({action:'set_location',url:'https://93.184.216.34/map',latitude:0,longitude:0});
  expect(calls).toEqual(['clear',{latitude:0,longitude:0},[['geolocation'],{origin:'https://93.184.216.34'}]]);
});
