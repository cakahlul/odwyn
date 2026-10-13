# Capability catalog draft

Planning only. No grants or production actions are registered by this document. Owner-defined names and Spaces are data; unknown actions and unsupported constraints must be denied.

| Current surface | Proposed canonical actions | Required resource identity/constraints | Platform floor |
| --- | --- | --- | --- |
| Browser | browser.navigate, browser.read, browser.interact, browser.submit | Space/task profile, origin, proxy-verified destination, actual operation and target | Ambiguous mutation deny/ask; high-impact action-bound owner approval |
| Terminal and generated files | sandbox.exec, filesystem.read, filesystem.write | Space/task sandbox ID, canonical in-sandbox paths, CPU/memory/process/time/output limits | No host executor fallback, secrets, sockets or credential mounts |
| Proxy/images/network | network.fetch | Exact connector/resource origin, DNS/IP and redirect validation, bytes/rate | Default-deny egress; no internal/control-plane destinations |
| Git via future broker | repository.read, repository.branch.create, repository.commit, repository.branch.push, repository.pr.create, repository.merge | Canonical connector repository ID, permitted refs, patch digest, CI-file restrictions, quotas | Protected merge and production deploy need step-up; token outside sandbox |
| Upload/download/history/search | file.upload, file.download, memory.read, memory.write | Classified file/message/conversation IDs, owner/Space, disclosure provenance and size | No foreign-resource disclosure; raw secrets never enter model/output |
| Rooms/workflow handoff | room.share | Source/destination Space, participant IDs, resource labels and bounded derived fields | Authority intersection; explicit cross-Space export only |
| Routines/retries | routine.create | Agent/Space/resource scope, schedule/window, expiry, current revision | Fresh policy on execution/recovery; no stale authority |
| MCP/provider connector | mcp.invoke and mapped domain actions | Reviewed connector manifest, concrete upstream tool/resource IDs, scoped credential handle | Unknown/unmappable endpoint disabled; no raw broad server catalog |
| Future task/document/calendar services | task.read/create/update/delete, document.read/draft/publish, calendar.read/propose/write | Exact connector/project/document/calendar IDs; destination/time/byte limits | External send/publish and destructive bulk operations require classified approval |
| Future finance/messages | finance.read/draft, payment.execute, message.send | Exact account/recipient, amount/currency/digest, budgets, idempotency | Consequential send/payment/commitment requires exact owner step-up |
| Administration/audit | Owner-only endpoints; no agent capability | Authenticated owner, optimistic revision and recent authentication | No agent self-grant, secret export or audit mutation |

Capability constraints must be versioned typed schemas. Resource selection cannot become shell, executable policy, arbitrary URL authority or provider instructions. Overlapping grants use tightest effective constraints; explicit deny wins. Auto/ask never overrides the floor. Presets start with empty resource selection.
