export function installLanes(root) {
  if (root.lanes) return;
  const prototype = Object.getPrototypeOf(root);
  root.lanes = new Map();
  root.contextForAgent = agentId => root.lanes.get(agentId)?.active ? root.lanes.get(agentId) : root;
  root.contextForJob = jobId => [...root.lanes.values()].find(lane => lane.active?.id === jobId) || root;
  root.activeJobs = () => [root.active, ...[...root.lanes.values()].map(lane => lane.active)].filter(Boolean);
  const concurrency = job => root.conversation(job)?.governance?.concurrency || 1;
  root.canRun = job => concurrency(job) === 1 && !root.activeJobs().some(active => active.agentId === job.agentId);

  for (const method of ['answer', 'cancel', 'executeApproved', 'finish', 'setInteractionMode']) {
    root[method] = (...args) => {
      const jobId = method === 'finish' ? args[0].id : method === 'executeApproved' ? root.store.approvals.request(args[0]).taskId : args[0];
      return prototype[method].apply(root.contextForJob(jobId), args);
    };
  }

  root.scheduleParallel = () => {
    if (root.closed || root.takeover) return;
    const starts = [];
    for (const job of [...root.state.jobs].reverse()) {
      if (job.status !== 'queued' || concurrency(job) < 2 || !root.accounts.get(job.agentId)?.account) continue;
      let lane = root.lanes.get(job.agentId);
      if (!lane) {
        lane = Object.create(prototype);
        for (const key of ['store', 'state', 'workspace', 'workspaceId', 'providers', 'accounts', 'sandbox', 'executions', 'gitGateway', 'repositoryGateway', 'connectors', 'scopedBrowsers', 'actionGateway']) lane[key] = root[key];
        Object.assign(lane, {active:null, starting:null, requests:new Map(), browser:{}, takeover:false, closed:false, toolTail:null, saveTimer:null, model:root.model, codex:root.providers.get(job.agentId)});
        lane.changed = root.changed.bind(root);
        lane.activeJobs = root.activeJobs;
        for (const method of ['answer', 'cancel', 'executeApproved', 'finish', 'setInteractionMode']) lane[method] = root[method];
        lane.canRun = candidate => {
          const room = root.conversation(candidate), active = root.activeJobs();
          return candidate.agentId === job.agentId && concurrency(candidate) > 1 && room?.discussion?.status === 'active' && candidate.roomRoundId === room.discussion.id
            && active.length < 5 && !active.some(item => item.agentId === candidate.agentId)
            && active.filter(item => item.conversationId === candidate.conversationId).length < concurrency(candidate);
        };
        root.lanes.set(job.agentId, lane);
      }
      if (!lane.active && !lane.starting && lane.canRun(job)) starts.push(lane.drain());
    }
    if (starts.length) return Promise.all(starts);
  };

  root.closeLanes = async () => {
    const lanes = [...root.lanes.values()];
    for (const lane of lanes) { lane.closed = true; clearTimeout(lane.saveTimer); }
    await Promise.all(lanes.map(async lane => {
      const job = lane.active;
      if (!job) return;
      for (const [id, pending] of lane.requests) { pending.reject(new Error('Service stopped.')); lane.requests.delete(id); }
      try {
        if (job.threadId && job.turnId) await lane.codex.request('turn/interrupt', {threadId:job.threadId, turnId:job.turnId});
      } catch { lane.codex.stop?.(); }
      if (lane.active === job) prototype.finish.call(lane, job, 'interrupted', 'Service stopped. Review progress before resuming.');
    }));
  };
}
