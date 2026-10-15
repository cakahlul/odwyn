# Isolated coding executor

Disabled by default. No host shell fallback. Server-owned configuration enables only non-root Linux workers on rootless Docker or Docker Desktop's Linux VM, with cgroup v2 budgets verified inside each worker. Rootless Linux remains preferred. Rootful native Linux is rejected.

Build the reviewed worker, then select its immutable image ID:

```sh
docker build --pull=false -t odwyn-security-worker:phase2 execution
docker image inspect odwyn-security-worker:phase2 --format '{{.Id}}'
```

Server configuration: `ODWYN_SANDBOX_IMAGE=sha256:<image-id>` and optional `ODWYN_SANDBOX_SNAPSHOTS=<owner-controlled-root>` (defaults to the Workspace data directory’s `sources/`). Configure each source in **Workspace Settings → Resources → Isolated workspace**: leave Source folder blank for `<root>/<spaceId>/<workspaceResourceId>`, or give a relative folder under the displayed root. Save creates missing private folders. Edit the saved resource to **Import project folder** from your computer or enter an absolute **Existing project folder on this server** and **Copy server project** into an empty source. The destination stays relative to the displayed root; server-copy origins are explicit owner-selected absolute paths outside Odwyn private data, provider home and managed sources. Symlink components and hard-linked files are rejected. Server copies use the existing descriptor-relative snapshot copier and preserve executable bits. The original project remains unchanged; no live mount or synchronization is created. Existing resource paths remain compatible. Only explicit `sandbox.exec` grants authorize execution; these variables never confer grants. Tests use a disposable server-owned snapshot resolver instead. Never place the application database or credentials in snapshots. No symlinks, Git config/hooks, credential files, special files or unrestricted host binds are copied. Limits: 16 MiB/4096 entries/depth 32; writable workspace 32 MiB and temporary directory 16 MiB.

Each task gets a distinct worker: UID/GID 1000, read-only root, all capabilities dropped, no-new-privileges, no network, 128 MiB RAM without extra swap, 64 PIDs, one CPU. Commands have a maximum 120-second timeout and bounded output; runtime limits remain 120 tool calls and one hour per task. Timeout, cancellation and output overflow kill the whole worker. Task finish/service close removes it. Failed provisioning removes the worker and returns a denial. Missing Docker/image/kernel controls never select a host-shell fallback.

`odwyn_repository_patch` exports a bounded patch from the exact task workspace. `odwyn_repository_push` accepts only a repository resource and branch ref. Owner grants must include exact `branchPrefixes` such as `['agent/']`; overlapping constraints intersect. Main/master/release, tags, unrelated history, force pushes, and CI/policy file changes remain denied. The server broker pins the resolved upstream IP, refuses redirects, bounds transport, and verifies receive-pack receipts. Credentials, if configured through the server-only resolver, remain in the broker; workers receive no token. No live credential source is enabled by default. Optional draft PRs remain unavailable.

Validation (fixtures only):

```sh
ODWYN_SECURITY_SANDBOX_IMAGE=sha256:<image-id> \
ODWYN_SECURITY_ISOLATION_RUNNER=1 bash scripts/security-gate.sh --phase 2
```

The declaration is not proof; the actual OS/upstream probes and unchanged JUnit verifier must pass. Release still requires Phases 3–5 and their disposable runner gate. Build tags can change; an image ID change requires review and a new gate run. Image package versions are recorded in the run evidence.

Rollback: unset both server variables and restart; revoke execution/push grants. This disables autonomy while retaining saved data. The grants migration creates a private, WAL-complete SQLite backup before adding `constraints` with default `{}`. Restore that backup only with the service stopped and its pre-migration application version; preserve/remove its corresponding WAL and SHM files as appropriate. Do not overwrite live SQLite state or use a stale WAL with a restored database.

## Isolated agent browser

Build from the repository root after `bun install --frozen-lockfile`:

```sh
docker build --pull=false -f execution/Dockerfile.browser -t odwyn-security-browser:reviewed .
docker image inspect odwyn-security-browser:reviewed --format '{{.Id}}'
```

Set server-owned `ODWYN_BROWSER_IMAGE=sha256:<reviewed-image-id>` separately from the terminal image. Continue starting the controller with `bun run start`; workers run in the supported rootless Linux backend. The image and grants are separate requirements. Missing image/backend/Chromium/controls denies agent browsing; no native host-browser fallback exists. Rollback: unset `ODWYN_BROWSER_IMAGE`, restart, revoke browser grants; saved chats and permissions remain.

The browser worker is per immutable task/Space/resource: UID/GID 1000, default Docker seccomp, no-new-privileges, dropped capabilities, read-only root, private PID/network namespaces, network none, no binds/ports/socket/owner profile, 512 MiB memory with no additional swap, 128 PIDs and one CPU. Private tmpfs holds 128 MiB temporary profile data and is destroyed with the worker. Session cookies and localStorage survive reads only inside that task/resource. Chromium closes after each read; cancellation, policy revocation, timeout, task completion and shutdown discard results and remove the container. Startup verifies actual kernel limits; output is bounded to 128 KiB and each operation to 30 seconds.

A controller broker performs credential-free public HTTP(S) GETs, pins public DNS/IP, and rejects private/reserved destinations, unsupported ports, non-HTML and over-256-KiB responses. New Browsing resources use `{blockedDomains:[]}`: each listed domain and its subdomains are prohibited; an empty list allows the public web. Up to five redirects are checked against the same blocklist and public-address rules before fetching. Existing `{readUrls:[...]}` resources retain exact HTTPS URL allowlists and reject redirects. Scope changes revoke resource grants, including wildcard access, for owner review.

Open pages (`browser.navigate`), Read page content (`browser.read`) and Interaction (`browser.interact`) have independent Blocked/Ask/Automatic grants. Reading remains a prerequisite; an exact approved navigation/control includes its returned read when Read also uses Ask, but can never bypass a Read deny. Interaction enables reference-based click/fill/type/select/press and scroll/wait controls. Inline page scripts run only during an authorized interaction. Visible DOM and form values persist between calls; JavaScript runtime state resets. Ordinary links use `navigate`; local fragment links may use Interaction. Credential entry and detected payments require owner takeover.

Known broker secrets are redacted before HTML enters the worker. The renderer receives the page over stdin, not a network connection or credential. Chromium routes abort every other request; kernel network-none contains a compromised renderer/whole browser. External scripts/subresources, network form submissions, authenticated browsing, pixel exports and downloads remain unavailable. A Show more button relying on an external script or API may therefore be unavailable. No external search service is provided; `odwyn_search` remains memory search. The authenticated owner's separate native browser is not an agent execution path.

Interaction requires rebuilding `execution/Dockerfile.browser`, reviewing/testing the new immutable image, updating `ODWYN_BROWSER_IMAGE` to its digest, and restarting the controller. `bun run setup` verifies an existing pinned image; it does not silently replace it. Old browser images reject control requests, preserving a fail-closed mixed-version rollout.

Chromium's optional inner namespace sandbox is not enabled: default Docker seccomp plus the full-process container is the tested boundary, matching arbitrary-code terminal containment. No privileged mode, extra capabilities, unconfined seccomp or host IPC is substituted to launch it. Kernel/container escapes and controller compromise remain residual risks; this is not a microVM. See [Playwright Docker](https://playwright.dev/docs/docker) and [Docker network none](https://docs.docker.com/engine/network/drivers/none/).

Full local phase validation:

```sh
ODWYN_SECURITY_SANDBOX_IMAGE=sha256:<terminal-image-id> \
ODWYN_SECURITY_BROWSER_IMAGE=sha256:<browser-image-id> \
ODWYN_SECURITY_ISOLATION_RUNNER=1 bash scripts/security-gate.sh --phase 5
```

`ODWYN_SECURITY_*` variables are disposable fixture configuration, not production grants. The release command still requires an actual disposable Linux runner; Docker Desktop only proves the isolated workers, not a Linux production deployment. Never mount its Docker socket into an agent worker. CI builds both images and retains all actual JUnit/proofs.

Crash containment: the container init process has a fixed one-hour OS lifetime, matching the task ceiling. A controller SIGKILL can leave an idle or active bounded worker until that deadline; no network/host access or credentials are added. Normal stop removes it immediately. After a crash, inspect task labels and remove only confirmed interrupted-task containers; never restart or reuse them. The acceptance suite verifies the actual init command and normal cgroup removal. It does not wait an entire hour to observe expiry.

## Automatic owner setup

After installing dependencies, run `bun run setup`. With rootless Linux Docker/cgroup v2 (or Docker Desktop on macOS), it builds only missing images, records their immutable IDs, creates an empty private `workspaces/` snapshot root, and writes the Docker socket/images/root to `.env` atomically after actual non-root kernel and Chromium checks. Existing configured immutable images are verified rather than replaced. Credentials are never printed; concurrent owner edits abort the write. No policy DB, resource, connection or permission is created. The checks establish readiness, not acceptance/release clearance. Existing image upgrades remain an explicit review/retest operation.

Without Docker, setup creates ordinary owner credentials and explains that isolated tools remain denied. Install rootless Docker using [Docker's official instructions](https://docs.docker.com/engine/security/rootless/) and [Ubuntu 24.04 guidance](https://docs.docker.com/engine/security/rootless/troubleshoot/), then rerun setup. macOS users start Docker Desktop first. Rootful Linux Docker is rejected. Setup never changes OS packages, services or global security settings. `--chat-only` skips worker setup; `--isolation` requires it and returns exit 2 if missing. Builds/probe failures return exit 2 without saving new worker settings.

The normal `bun run start` command loads `.env` through Bun. Services started outside this checkout must load the same owner configuration explicitly; shell exports alone are temporary. Source folders are managed through Resources settings as described above; no manual UUID directory preparation is needed. Import excludes known credential filenames, Git metadata, dependencies and build outputs, and rejects known configured secrets. Review all source for other secrets or live data. Imports are bounded to 16 MiB/4096 entries/depth 32, preserve executable bits only for server copies, and require an empty folder, stopped Space tasks and no existing resource checkpoint. Changing a source revokes grants. Accepted agent changes remain checkpoints rather than overwriting the source folder. `workspaces/` is ignored by Git.


## Checkpoints and recorded tests

Checkpoint manifests live privately under `<data directory>/checkpoints`. Only
bounded regular workspace files are captured; credentials, Git configuration,
hooks, symlinks and special files are rejected. Checkpoints are immutable and
Space/resource scoped. Successful task completion saves modified work before the
worker is removed. Cancellation or a failed save never promotes a new head.
Parallel writers use compare-and-set: a losing branch remains recorded without
overwriting the winner. The owner can explicitly select a retained checkpoint
after stopping workspace tasks. Export selected checkpoints through room handoff
into an empty destination workspace; this grants no execution permission.

`odwyn_checkpoint` saves or selects a task's initial checkpoint. A task pins one
workspace/checkpoint; start another task to move to a newer head.
`odwyn_test_case` defines cases, dependencies and defects. `odwyn_run_test` records
the real command, exact checkpoint, exit status, bounded redacted output and case
revision. Every recorded command restores fresh checkpoint files and destroys its
test worker afterward. Timeouts, cancellations, truncated output and failed exits
cannot count as passing evidence. New checkpoint/case revisions require retests.
Manual UAT entered by the owner stays distinctly attributed to the owner.

`workspace.read` grants evidence access without executing commands. Existing
execution grants provide read compatibility unless an explicit read rule exists.
Room disclosure still requires the participant read intersection.

The trusted server can set `ODWYN_EXECUTION_PROFILE` to a JSON object, for example:

```sh
ODWYN_EXECUTION_PROFILE='{"memory":1024,"pids":128,"cpus":2,"workspace":256,"temporary":128,"timeoutMs":120000}'
```

Memory, workspace and temporary sizes are MiB. Defaults remain 128/32/16 MiB,
64 PIDs, one CPU, 120 seconds. Bounds are 64–4096 MiB memory, 16–1024 MiB workspace,
8–1024 MiB temporary, 16–1024 PIDs, 1–8 CPUs, and at most 120 seconds per command.
Checkpoint contents remain capped at 16 MiB/4096 files regardless of worker size.
Profiles never enable networking, host mounts, credentials or native mobile
emulators. Dependencies must already exist in the reviewed image/snapshot.
Unsupported targets fail rather than silently using host execution.


## Linked Git workspaces

Owner Repository resources may set `gitUsername` for Basic username/token authentication and an existing scoped Git connection for `repository.read` credentials. Workspace resources link the same-Space Repository via `metadata.repositoryId`. The `odwyn_repository_sync` tool requires both repository read and workspace execution authority, records provenance before fetch, and rechecks current permissions and room disclosure after async operations. Owner configuration remains subject to existing idle/checkpoint restrictions.

The host broker resolves/pins public HTTPS, refuses redirects, and fetches a bounded smart-HTTP SHA-1 pack; only workers unpack objects. Workers remain network-none with no host mounts or provider credentials. Git configuration/hooks are excluded from checkpoints; restored workers use the broker again. Fetch staging is removed; no force reset or automatic cleanup of user files occurs. Initial copied source must exactly match the selected commit, including absence of ignored extras. Subsequent branch updates require clean files and fast-forward ancestry.

shortcut: fetch requests full history (8 MiB pack); add bounded incremental negotiation when real repositories exceed this limit. Git objects count toward the existing 16 MiB/4096-entry checkpoint and worker tmpfs limits. SSH, redirects, submodules and LFS downloads are unsupported. See [UI setup](../docs/USAGE.md#git-checkout-and-pull).
