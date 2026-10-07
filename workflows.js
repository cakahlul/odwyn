import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { textInput } from './security.js';

const identifier = /^[a-z][a-z0-9_-]{0,59}$/;
const forbidden = new Set(['__proto__','constructor','prototype']);
export const stepTypes = ['agent','browser','terminal','condition','approval','output'];
const key = value => {
  if (typeof value !== 'string' || !identifier.test(value) || forbidden.has(value)) throw new Error('Use lowercase names starting with a letter; letters, numbers, hyphens and underscores only.');
  return value;
};
const optionalText = (value, max=20000) => value == null || value === '' ? '' : textInput(value,max);
export function validateSkill(input) {
  return {id:input.id || randomUUID(),name:textInput(input.name,80),command:key(input.command),description:optionalText(input.description,500),instructions:textInput(input.instructions),updatedAt:new Date().toISOString()};
}
export function validateWorkflow(input,state) {
  const command = key(input.command), id = input.id || randomUUID();
  if (state.workflows?.some(w=>w.command===command && w.id!==id) || state.skills?.some(s=>s.command===command)) throw new Error('Command already exists.');
  if (!Array.isArray(input.steps) || !input.steps.length || input.steps.length>100) throw new Error('Add 1 to 100 steps.');
  const inputs = (input.inputs || []).map(field=>({name:key(field.name),label:optionalText(field.label,80) || field.name,required:field.required===true,...(field.default!==undefined ? {default:field.default} : {})}));
  if (inputs.length>30 || new Set(inputs.map(f=>f.name)).size!==inputs.length) throw new Error('Use up to 30 uniquely named inputs.');
  const steps = input.steps.map((step,index)=>{
    if (!stepTypes.includes(step.type)) throw new Error('Choose a supported step type.');
    if (step.agentId && !state.agents.some(a=>a.id===step.agentId)) throw new Error('Step agent not found.');
    if (!Array.isArray(step.skills || []) || (step.skills || []).length>30 || new Set(step.skills || []).size!==(step.skills || []).length || (step.skills || []).some(id=>!state.skills?.some(s=>s.id===id))) throw new Error('Step skill not found.');
    if (!Array.isArray(step.tools || []) || new Set(step.tools || []).size!==(step.tools || []).length || (step.tools || []).some(t=>!['browser','terminal','search','ask','send_file','remember','schedule'].includes(t))) throw new Error('Choose supported tools.');
    const next = step.next === undefined ? input.steps[index+1]?.id || null : step.next;
    const retries = step.retries ?? 0;
    if (!Number.isInteger(retries) || retries<0 || retries>5) throw new Error('Retries must be between 0 and 5.');
    const result = {id:key(step.id),name:optionalText(step.name,80) || step.id,type:step.type,agentId:step.agentId || null,skills:[...(step.skills || [])],tools:step.tools===undefined ? ['browser','terminal','search','ask','send_file'] : [...step.tools],prompt:optionalText(step.prompt),next,retries,retrySafe:step.retrySafe===true,format:step.format==='json' ? 'json':'text'};
    if(step.position!==undefined) {
      if(!step.position || ['x','y'].some(axis=>!Number.isFinite(step.position[axis]) || step.position[axis]<0 || step.position[axis]>10000)) throw new Error('Canvas positions must be between 0 and 10,000.');
      result.position={x:step.position.x,y:step.position.y};
    }
    if (['agent','approval','output'].includes(step.type) && !result.prompt) throw new Error('Add step instructions.');
    if (['agent','output'].includes(step.type) && step.responsePrompt?.trim()) {
      result.responsePrompt=textInput(step.responsePrompt,8000);
      result.responseLabel=optionalText(step.responseLabel,80) || 'Send selected items';
      result.responseItems=key(step.responseItems || 'items');
      if(step.type==='agent') result.format='json';
    }
    if(step.type==='approval') result.options=structuredClone(step.options || []);
    if (step.type==='browser' || step.type==='terminal') {
      if (!step.action || Array.isArray(step.action) || typeof step.action!=='object') throw new Error('Add action parameters.');
      result.action=structuredClone(step.action);
    }
    if (step.type==='condition') {
      if (!['equals','not_equals','contains','exists','truthy','greater_than','less_than'].includes(step.operator)) throw new Error('Choose a condition operator.');
      result.value=step.value ?? ''; result.compare=step.compare ?? ''; result.operator=step.operator; result.otherwise=step.otherwise ?? null;
    }
    return result;
  });
  const ids = new Set(steps.map(s=>s.id));
  if (ids.size!==steps.length) throw new Error('Step IDs must be unique.');
  const start = input.start || steps[0].id;
  if (!ids.has(start) || steps.some(s=>s.next!==null && !ids.has(s.next) || s.type==='condition' && s.otherwise!==null && !ids.has(s.otherwise))) throw new Error('Connections must point to an existing step or Finish.');
  const maxSteps = input.maxSteps ?? 100;
  if (!Number.isInteger(maxSteps) || maxSteps<1 || maxSteps>1000) throw new Error('Execution limit must be between 1 and 1,000 steps.');
  return {id,name:textInput(input.name,80),command,description:optionalText(input.description,500),inputs,steps,start,maxSteps,updatedAt:new Date().toISOString()};
}
export function pathValue(path,context) {
  let value=context;
  for (const part of path.trim().split('.')) {
    if (forbidden.has(part) || value==null || !Object.hasOwn(Object(value),part)) throw new Error(`Unavailable workflow field: ${path}`);
    value=value[part];
  }
  return value;
}
export function interpolate(value,context) {
  if (typeof value==='string') {
    const exact=value.match(/^\{\{\s*([\w.-]+)\s*\}\}$/);
    if (exact) return structuredClone(pathValue(exact[1],context));
    return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g,(_,path)=>{const field=pathValue(path,context);return typeof field==='string' ? field:JSON.stringify(field);});
  }
  if (Array.isArray(value)) return value.map(item=>interpolate(item,context));
  if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([name,item])=>{
    if (forbidden.has(name)) throw new Error('Unsafe workflow field.');
    return [name,interpolate(item,context)];
  }));
  return value;
}
export function condition(step,context) {
  let value;
  try {value=interpolate(step.value,context);} catch(error) {if(step.operator==='exists') return false;throw error;}
  const compare=['exists','truthy'].includes(step.operator) ? undefined:interpolate(step.compare,context);
  switch(step.operator) {
    case 'equals': return isDeepStrictEqual(value,compare);
    case 'not_equals': return !isDeepStrictEqual(value,compare);
    case 'contains': return Array.isArray(value) ? value.includes(compare):String(value).includes(String(compare));
    case 'exists': return value!==undefined && value!==null;
    case 'truthy': return !!value;
    case 'greater_than': return Number(value)>Number(compare);
    case 'less_than': return Number(value)<Number(compare);
  }
}
export function workflowInvocation(prompt,state) {
  const match=prompt.trim().match(/^([/$])([a-z][a-z0-9_-]*)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  const workflow=state.workflows?.find(w=>w.command===match[2]),skill=state.skills?.find(s=>s.command===match[2]);
  if (!workflow && !skill) throw new Error(`Unknown command: ${match[1]}${match[2]}. Create it in Workflows.`);
  const argument=(match[3] || '').trim();
  let inputs={};
  if (workflow && argument) {
    if (argument.startsWith('{')) {
      inputs=JSON.parse(argument);
      if (!inputs || Array.isArray(inputs) || typeof inputs!=='object') throw new Error('Supply workflow inputs as a JSON object.');
    } else if (workflow.inputs.length) inputs[workflow.inputs[0].name]=argument;
    else inputs={args:argument};
  }
  return workflow ? {workflow,inputs}:{skill,argument};
}

export function commandParameters(action,context) {
  const parameters=interpolate({...action,command:undefined},context);
  if(typeof action.command!=='string') throw new Error('Add a terminal command.');
  // Templates are shell arguments, never raw shell code from a previous step.
  parameters.command=action.command.replace(/\{\{\s*([\w.-]+)\s*\}\}/g,(match,path,offset)=>{
    const prefix=action.command.slice(0,offset);let quote=null,escaped=false;
    for(const character of prefix) {
      if(escaped){escaped=false;continue;}
      if(character==='\\' && quote!=="'"){escaped=true;continue;}
      if(quote){if(character===quote)quote=null;}
      else if(["'",'"','`'].includes(character))quote=character;
    }
    if(quote || escaped || action.command.includes('<<')) throw new Error('Place terminal field references outside quotes and heredocs. Values are quoted automatically.');
    const value=pathValue(path,context),argument=typeof value==='string' ? value:JSON.stringify(value);
    return "'"+argument.replaceAll("'","'\\''")+"'";
  });
  return parameters;
}
