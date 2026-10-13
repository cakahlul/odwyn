import { test, expect } from 'bun:test';
import { taskSecurityContext } from '../../../security/task-context.js';

test('Phase 0 task identity snapshot validates and cannot acquire persona authority', () => {
  const input = {ownerId:'owner-fixture',agentId:'agent-fixture',taskId:'task-fixture',spaceId:'space-fixture',policyRevision:0,name:'Anything',interactionMode:'allow'};
  const context = taskSecurityContext(input);
  input.agentId = 'substituted';
  expect(context.agentId).toBe('agent-fixture');
  expect(Object.isFrozen(context)).toBe(true);
  expect(() => {context.spaceId = 'foreign';}).toThrow();
  expect(context.name).toBeUndefined();
  expect(context.interactionMode).toBeUndefined();
  for (const key of ['ownerId','agentId','taskId','spaceId']) {
    expect(() => taskSecurityContext({...input,[key]:''})).toThrow();
    expect(() => taskSecurityContext({...input,[key]:'a\0b'})).toThrow();
  }
  for (const policyRevision of [-1,NaN,0.5,Number.MAX_SAFE_INTEGER+1]) expect(() => taskSecurityContext({...input,policyRevision})).toThrow();
});
