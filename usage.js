const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
export function usage(raw={},provider){
  const input=number(raw.prompt_tokens??raw.input_tokens??raw.inputTokens);
  const output=number(raw.completion_tokens??raw.output_tokens??raw.outputTokens);
  const cached=number(raw.prompt_tokens_details?.cached_tokens??raw.cache_read_input_tokens??raw.cachedInputTokens??raw.cache_read_tokens??raw.cached);
  const written=number(raw.cache_creation_input_tokens??raw.cacheWriteInputTokens);
  const inputTokens=provider==='claude'&&input!==null?input+(cached||0)+(written||0):input;
  return {inputTokens,outputTokens:output,cachedInputTokens:cached,cacheWriteTokens:written,
    reasoningTokens:number(raw.completion_tokens_details?.reasoning_tokens??raw.reasoningOutputTokens??raw.thinking_tokens),
    totalTokens:number(raw.total_tokens??raw.totalTokens)??(inputTokens!==null&&output!==null?inputTokens+output:null),
    // Claude SDK costs are estimates; generic API cost fields have no guaranteed currency.
    costUSD:provider==='openrouter'?number(raw.cost):null};
}
export function sumUsage(reports){
  const keys=['inputTokens','outputTokens','cachedInputTokens','cacheWriteTokens','reasoningTokens','totalTokens','costUSD'];
  return Object.fromEntries([...keys.map(key=>[key,reports.some(r=>r?.[key]!=null)?reports.reduce((sum,r)=>sum+(r?.[key]||0),0):null]),
    ['partial',reports.some(r=>!r||r.partial||r.totalTokens==null)],['costPartial',reports.some(r=>!r||r.costUSD==null||r.costPartial)]]);
}
