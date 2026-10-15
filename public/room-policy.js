// Shared status calculation; authorization and review mutations stay server-side.
export function roomContributors(room) {
  return room.governance ? room.memberIds.filter(id=>!room.governance.observerIds.includes(id)) : room.discussion?.memberIds || [];
}

export function roomCompletion(room) {
  const outcome=room.discussion?.outcome;
  const pendingAgentIds=roomContributors(room).filter(id=>!outcome?.confirmations[id]);
  const reviewerIds=room.governance?.reviewerIds || [];
  const pendingReviewerIds=reviewerIds.filter(id=>outcome?.reviews?.[id]?.proposalId!==outcome?.id || outcome?.reviews?.[id]?.decision!=='approve');
  const changesRequested=reviewerIds.some(id=>outcome?.reviews?.[id]?.proposalId===outcome?.id && outcome?.reviews?.[id]?.decision==='changes_requested');
  const artifacts=room.artifacts||[],outputs=room.governance?.outputs||[];
  const pendingOutputIds=outputs.filter(output=>!artifacts.some(artifact=>artifact.outputId===output.id&&artifact.versions.length)).map(output=>output.id);
  const pendingArtifactIds=artifacts.filter(artifact=>!artifactApproved(room,artifact)).map(artifact=>artifact.id);
  const artifactChangesRequested=artifacts.some(artifact=>reviewerIds.some(id=>artifact.versions.at(-1)?.reviews?.[id]?.decision==='changes_requested'));
  const snapshotCurrent=JSON.stringify(outcome?.artifacts||[])===JSON.stringify(artifactSnapshot(room));
  const pendingCaseIds=(room.cases||[]).filter(item=>!casePassed(room,item)).map(item=>item.id);
  const checksCurrent=!room.cases?.length&&!room.evidence?.length&&!room.targetCheckpointId || JSON.stringify(outcome?.checks)===JSON.stringify(checkSnapshot(room));
  const agentReady=!!outcome && checksCurrent && !pendingCaseIds.length && snapshotCurrent && !room.discussion.invalidatedReason && !pendingAgentIds.length && !pendingReviewerIds.length && !changesRequested && !artifactChangesRequested && !pendingOutputIds.length && !pendingArtifactIds.length;
  const pendingOwnerApproval=!!room.governance?.ownerApproval && (outcome?.ownerDecision?.proposalId!==outcome?.id||outcome?.ownerDecision?.decision!=='approve');
  return {pendingAgentIds,pendingReviewerIds,pendingOutputIds,pendingArtifactIds,pendingCaseIds,changesRequested:changesRequested||artifactChangesRequested,agentReady,pendingOwnerApproval,ready:agentReady&&!pendingOwnerApproval};
}

export function artifactApproved(room,artifact){
  const version=artifact.versions.at(-1);if(!version)return false;
  if(artifact.kind==='evidence'&&(!version.evidenceIds?.length||version.evidenceIds.some(id=>!room.evidence?.some(evidence=>evidence.id===id&&evidence.status==='passed'&&!evidence.stale&&(!room.targetCheckpointId||evidence.checkpointId===room.targetCheckpointId)))))return false;
  return (room.governance?.reviewerIds||[]).every(id=>version.reviews?.[id]?.decision==='approve');
}

export function artifactSnapshot(room){return (room.artifacts||[]).map(artifact=>({id:artifact.id,versionId:artifact.versions.at(-1).id}));}

export function casePassed(room,item){return item.status==='passed'&&!!room.targetCheckpointId&&item.checkpointId===room.targetCheckpointId&&(room.evidence||[]).some(evidence=>evidence.id===item.evidenceId&&evidence.caseId===item.id&&evidence.caseRevision===item.revision&&evidence.checkpointId===room.targetCheckpointId&&evidence.status==='passed'&&!evidence.stale);}
export function checkSnapshot(room){return {checkpointId:room.targetCheckpointId||null,cases:(room.cases||[]).map(item=>({id:item.id,revision:item.revision,evidenceId:item.evidenceId||null,status:item.status})),evidenceIds:(room.evidence||[]).map(item=>item.id)};}
