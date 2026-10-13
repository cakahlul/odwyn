// Explicit disposable owner grants; never enables an unavailable executor.
export function grantFiles(store,agentId,paths) {
  const p=store.security,spaceId=p.legacySpaceId,access=p.access(agentId);
  const resources=paths.map(path=>p.createResource({spaceId,type:'file',name:path,metadata:{path}}));
  p.putAccess(agentId,{revision:p.revision,spaceIds:[...new Set([...access.spaceIds,spaceId])],grants:[...access.grants.map(({spaceId,resourceId,action,mode,expiresAt})=>({spaceId,resourceId,action,mode,...(expiresAt?{expiresAt}:{})})),...resources.map(r=>({spaceId,resourceId:r.id,action:'file.download',mode:'auto',constraints:{}}))]});
  return Object.fromEntries(resources.map((r,i)=>[paths[i],r.id]));
}
