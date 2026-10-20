// USD per million tokens: input, cached input, cache write, output. Verified 2026-10-20.
const openai='https://developers.openai.com/api/docs/pricing';
const google='https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing';
const prices={
  codex:{
    'gpt-6.1-sol':[2,.1,2.5,10], 'gpt-6-sol':[2,.2,2.5,10],
    'gpt-6-astra':[10,1,12.5,50], 'gpt-6-luna':[.1,.01,.125,.5],
    'gpt-5.6-sol':[4,.4,5,20], 'gpt-5.4':[2.5,.25,2.5,15], 'gpt-5.3-codex':[1.75,.175,1.75,14],
  },
  antigravity:{
    'gemini-4-argon':[2,.1,2,10],
    'gemini-3.8-flash':[.75,.075,.75,3.75], 'gemini-3.7-flash':[.75,.075,.75,3.75], 'gemini-3.6-flash':[.75,.075,.75,3.75],
    'gemini-3.1-pro':[2,.2,2,12],
    'claude-sonnet-5.5':[2,.1,2.5,10], 'claude-opus-5.5':[4,.2,5,20],
    'claude-sonnet-4.6':[3,.3,3.75,15], 'claude-opus-4.6':[5,.5,6.25,25],
    'gpt-oss-120b':[.09,.09,.09,.36],
  },
};
function modelName(value=''){
  if(typeof value!=='string')return '';
  return value.toLowerCase().trim().replace(/\s*\((?:low|medium|high|xhigh|max|thinking)\)/g,'').replace(/\s+/g,'-')
    .replace(/-(?:low|medium|high|xhigh|max|thinking)$/,'').replace(/-preview$/,'').replace(/-20\d\d-\d\d-\d\d$/,'').replace(/^(claude-(?:sonnet|opus))-(\d+)-(\d+)$/,'$1-$2.$3');
}
export function estimateCost(row){
  if(row.usage?.costUSD!=null&&!row.usage.costPartial)return null;
  const provider=row.provider?.type,model=modelName(row.provider?.resolvedModel||row.provider?.model);
  let rates=Object.hasOwn(prices,provider)&&Object.hasOwn(prices[provider],model)?prices[provider][model]:null;
  if(!rates)return {unavailableReason:!model||model==='default'?'The model was not recorded. Older CLI-default logs cannot be priced.':'No documented reference price is configured for this model.'};
  const date=(row.startedAt||row.createdAt||'2026-10-20').slice(0,10);
  const geminiPromo=provider==='antigravity'&&/^gemini-(?:4-argon|3\.[678]-flash)$/.test(model);
  const promoEnded=geminiPromo&&date>(model==='gemini-4-argon'?'2026-11-30':'2026-12-31');
  if(promoEnded)rates=rates.map(rate=>rate*2);
  const report=row.usage;
  if(!report||![report.inputTokens,report.outputTokens].every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0))return {unavailableReason:'Input/output token counts were not reported.'};
  const cached=report.cachedInputTokens??0,written=report.cacheWriteTokens??0;
  if(![cached,written].every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0)||cached+written>report.inputTokens)return {unavailableReason:'The reported cache/token breakdown is inconsistent.'};
  const [input,cachedInput,cacheWrite,output]=rates;
  const amountUSD=((report.inputTokens-cached-written)*input+cached*cachedInput+written*cacheWrite+report.outputTokens*output)/1e6;
  const notes=['API-equivalent token value, not a subscription charge. Standard short-context rates; excludes regional/priority premiums, tool fees, cache storage and taxes. Cache writes use ordinary input rates unless a separate rate is published.'];
  if(model==='gpt-oss-120b')notes.push('No separate cache-hit price is published; cached input uses the ordinary input rate.');
  if(report.cachedInputTokens==null||report.cacheWriteTokens==null)notes.push('Unreported cache tokens are treated as ordinary input.');
  if(geminiPromo&&!promoEnded)notes.push('Reference rates include documented promotional credits; eligibility may differ.');
  return {amountUSD,model,rates:{input,cachedInput,cacheWrite,output},sourceURL:provider==='codex'?openai:google,verifiedAt:'2026-10-20',partial:!!report.partial,notes};
}
export const withCostEstimate=row=>({...row,costEstimate:estimateCost(row)});
