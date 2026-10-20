# Room workflows

Room stages use the same room editor as ordinary conversations: select participants, a facilitator, reviewers, observers, required outputs and optional owner approval. Stages execute sequentially and preserve their snapshotted configuration for the run.

Authors save draft text or files as versioned artifacts. Revisions reset review and completion gates. Every non-observer participant confirms the current shared proposal; designated reviewers approve it separately. Required outputs must exist and pass their reviews. Owner approval, when configured, completes the stage and publishes approved files.

Pass to next room copies selected approved artifact versions and attachment bytes, the shared result, next plan and open questions into a durable package. Repeating the same handoff returns the same destination. The next room receives Start stage; automatic-advance workflows perform these transitions automatically. Failures roll back newly created destinations and files. Original artifact versions remain in their source room.

Code changes use the workspace’s host folder and terminal. There are no isolated workers, execution snapshots, checkpoint selectors, scoped exports or brokered Git promotion tools. Run project tests through the terminal and include real results in reviewed deliverables.

See [Workflows](WORKFLOWS.md) for launch inputs, attachments and stage configuration.
