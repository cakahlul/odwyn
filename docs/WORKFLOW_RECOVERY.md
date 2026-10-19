# Reliable room workflows

Room retries preserve the current discussion, unfinished participants, saved artifacts, and eligible reviews. They do not resend an owner message or create a new goal. New owner direction still creates a new discussion and invalidates work where the requirements or source versions changed.

Owner answers are recorded. If the provider already ended its turn while asking, the answer starts one continuation on the same thread. A reply to a still-live tool call follows its normal response path. Old turn events cannot resume a different turn.

Room workflows continue automatically at the 120-tool turn boundary, retaining their work and discussion. The room's one-hour execution limit still applies. Other tasks keep their existing review-and-resume limit. Provider interruption failures remain visible interruptions rather than replaying uncertain operations.

## Work and checkpoint recovery

Every completed terminal command checkpoints its workspace before returning, including commands that exit nonzero. Unchanged file content retains its checkpoint identity and verification evidence. Read-only Git inspections disable optional index writes. Prepared dependencies and untracked generated build output are omitted; tracked source in build/output directories is preserved.

Shell output is bounded without stopping the worker. A timed-out or cancelled command still terminates its worker to contain all descendants. Its partial, uncheckpointed writes can be lost; the previous completed command's saved work survives. The runtime does not claim a terminated command completed successfully.

A genuine concurrent checkpoint conflict retains both versions and identifies the saved work. Stop the room and choose the intended checkpoint in its Checkpoints section. Selection compares the expected current head and invalidates stale test/review evidence. Retry cannot bypass an unresolved conflict by selecting another participant.

The workflow status follows its current room: owner questions and owner approval wait, stopped work is interrupted, and a ready handoff is identified separately. The original stop reason survives a provider disconnect.

## npm executor preparation

Build the updated base executor, then prepare dependencies from the project's authoritative npm lockfile. For an npm workspace repository, use the repository root, not a stale app-local lockfile.

```sh
docker build -f execution/Dockerfile --iidfile /tmp/odwyn-executor-id .
ODWYN_SANDBOX_IMAGE="$(cat /tmp/odwyn-executor-id)" \
  bun scripts/prepare-executor.js /absolute/path/to/project .
```

Preparation copies bounded package manifests only into a separate image build. It uses frozen `npm ci`, includes development dependencies, disables install scripts, and rejects external registry/Git dependencies and unsupported legacy lockfile layouts. Credentials, `.npmrc`, application source, and owner environment variables are not copied into the build. npm workspaces use their root lockfile and retain links to their runtime source.

The resulting immutable image contains Node, npm, Bun, Git, and read-only dependencies. Workers remain unprivileged, network-isolated, and unable to alter the image. Manifest hashes must match before dependency links are attached. A changed manifest requires rebuilding the prepared executor. Packages requiring installation scripts or private registries require a separately reviewed project image; this path does not silently run those scripts or expose credentials.

Set `ODWYN_SANDBOX_IMAGE` to the resulting image ID and choose sufficient bounded `ODWYN_EXECUTION_PROFILE` resources for the actual project. For example, a Next.js project can use:

```dotenv
ODWYN_EXECUTION_PROFILE={"memory":2048,"pids":256,"cpus":2,"workspace":512,"temporary":256}
```

These values are MiB for memory/workspace/temporary storage and remain within the server's existing bounds. Verify the project's actual build requirements and available host capacity. Restart the service after configuration changes.

## Stage configuration

In workflow settings, enable **Automatically pass completed room stages** to transfer reviewed deliverables and start the next stage. Configured owner approvals still pause before advancing. Automatic checkpoint transfer uses the next stage's configured execution workspace, or an unambiguous shared project identity; it never guesses between unrelated resources or overwrites an existing destination head. If a choice is required, the room shows a handoff error and the existing manual handoff remains available.

For execution, testing, or release stages, choose an **Execution workspace** in the room's Space. Its Node/npm/dependency preflight runs before the provider receives work. Inspection-only stages can omit it. The JSON equivalents are workflow `autoAdvance: true` and stage `workspaceResourceId`.

Required outputs should match the scope. An unaffected engineer may supply a concise no-change record; do not require them to invent implementation or a test suite. If the owner defers mandatory verification, preserve the code and explicitly report the unverified handoff. Passing evidence, configured reviews, and release approvals remain required for a tested merge or release-ready result.
