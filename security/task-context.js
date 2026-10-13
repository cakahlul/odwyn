// Server-only identity snapshot. Phase 0 does not wire this into execution or grant access.
export function taskSecurityContext({ownerId, agentId, taskId, spaceId, policyRevision}) {
  for (const value of [ownerId, agentId, taskId, spaceId]) {
    if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Invalid security context identity.');
  }
  if (!Number.isSafeInteger(policyRevision) || policyRevision < 0) throw new Error('Invalid policy revision.');
  return Object.freeze({ownerId, agentId, taskId, spaceId, policyRevision});
}
