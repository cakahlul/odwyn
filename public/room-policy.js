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
  return {pendingAgentIds,pendingReviewerIds,changesRequested,ready:!!outcome && !room.discussion.invalidatedReason && !pendingAgentIds.length && !pendingReviewerIds.length && !changesRequested};
}
