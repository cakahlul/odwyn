import {test,expect} from 'bun:test';
import {estimateCost} from '../pricing.js';
import {openStore,createJob} from '../store.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const row=(type,model,usage)=>({provider:{type,model},usage});
test('Codex estimates price uncached, cached, cache-write and output tokens exactly once',()=>{
 const estimate=estimateCost(row('codex','gpt-6.1-sol',{inputTokens:1000000,cachedInputTokens:400000,cacheWriteTokens:100000,outputTokens:200000,reasoningTokens:50000}));
 expect(estimate.amountUSD).toBeCloseTo(3.29,9);expect(estimate.rates).toEqual({input:2,cachedInput:.1,cacheWrite:2.5,output:10});expect(estimate.sourceURL).toContain('developers.openai.com');expect(estimate.verifiedAt).toBe('2026-10-20');
});
test('Antigravity estimates use resolved model, accept display names and effort slugs',()=>{
 const report={inputTokens:1000000,cachedInputTokens:250000,outputTokens:100000,reasoningTokens:50000};
 const value={...row('antigravity','default',report),provider:{type:'antigravity',model:'default',resolvedModel:'Gemini 4 Argon (Medium)'}};
 expect(estimateCost(value).amountUSD).toBeCloseTo(2.525,9);
 expect(estimateCost(value).notes.join(' ')).toContain('promotional');
 expect(estimateCost({...value,startedAt:'2026-12-01T00:00:00.000Z'}).amountUSD).toBeCloseTo(5.05,9);
 expect(estimateCost({...row('antigravity','gemini-3.8-flash',report),createdAt:'2027-01-01T00:00:00.000Z'}).rates.input).toBe(1.5);
 expect(estimateCost(row('antigravity','gemini-4-argon-high',report)).amountUSD).toBeCloseTo(2.525,9);
 expect(estimateCost(row('antigravity','Claude Sonnet 5.5 (Thinking)',report)).amountUSD).toBeCloseTo(2.525,9);
 expect(estimateCost(row('antigravity','claude-sonnet-5-5-high',report)).amountUSD).toBeCloseTo(2.525,9);
 expect(estimateCost(row('antigravity','gpt-oss-120b-medium',report)).amountUSD).toBeCloseTo(.126,9);
});
test('estimates preserve reported charges, label partial data and reject unknown or inconsistent data',()=>{
 expect(estimateCost(row('codex','gpt-6.1-sol',{costUSD:0}))).toBeNull();
 expect(estimateCost(row('codex','gpt-6.1-sol',{inputTokens:100,outputTokens:10,partial:true}))).toMatchObject({partial:true,amountUSD:.0003});
 for(const value of [row('antigravity','default',{inputTokens:10,outputTokens:1}),row('codex','constructor',{}),row('constructor','gpt-6.1-sol',{}),row('codex','gpt-6.1-sol',{totalTokens:20}),row('codex','gpt-6.1-sol',{inputTokens:10,outputTokens:1,cachedInputTokens:11})])expect(estimateCost(value).unavailableReason).toBeTruthy();
});
test('old audit entries gain estimates without rewriting actual charges or requiring their chat',()=>{
 const directory=mkdtempSync(join(tmpdir(),'odwyn-estimate-'));const store=openStore(directory);
 try{const job=createJob(store.state,{prompt:'Historical task'});job.status='completed';job.providerSnapshot={type:'codex',model:'gpt-6.1-sol'};job.usage={inputTokens:1000,outputTokens:100,cachedInputTokens:200,cacheWriteTokens:0};store.save();store.deleteConversation(job.conversationId);
  const detail=store.audit.detail(job.id,new URLSearchParams());expect(detail.costEstimate.amountUSD).toBeCloseTo(.00262,9);expect(detail.usage.costUSD).toBeUndefined();expect(store.audit.list(new URLSearchParams()).rows[0].costEstimate).toEqual(detail.costEstimate);
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
