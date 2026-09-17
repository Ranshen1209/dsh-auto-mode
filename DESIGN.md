# Preservation-first Auto design

The policy protects existing data from model-generated or inferred execution authority. It trades unattended builds and shell convenience for deterministic rejection when independent isolation cannot be established. No language-model classifier is an authorization source.

## Decision and commit chain

1. Resolve the active Auto authority, including live delegated lineage. Record each observed call token, actor and permission-event history, including calls initially denied. Changing modes and changing back does not revive a pending call.
2. Reject unverified capabilities by default. Exact audited session tools and structured workspace reads are the narrow automatic surface. Reads and edits must use the real tool's parameter name; conflicting aliases cannot choose a different approval target.
3. Check raw paths before normalization, then every filesystem ancestor and the final regular file. Reject ambiguous Win32/NT/UNC/drive-relative/ADS/short-name/device paths, links/junctions, multiple file links, protected metadata and inaccessible paths. File reads/identity hashes are bounded to 16 MiB.
4. Review the complete pending action using the official source-role partition of logged instructions and facts. Exclude assistant text and tool results as authorization; project content may only restrict scope. Require a new model allow for each call, without inheriting Full access. For every structured file operation, require the backend’s explicit host-file mapping contract; identical path strings in a remote filesystem are insufficient. For exact structured edits, capture the backend target and file version. Ask the official approval service with the original callId. Only `allowed-once` succeeds; rejection, cancellation, unavailability, exception or a 120-second timeout denies. Delegated agents cannot ask for their own approval.
5. A monotonic tool guard checks the deterministic policy after the extensible pre-execute waterfall. A separate dispatch check detects changed authority/arguments and repeated around-tool dispatch. A different pre-execute listener returning allow cannot supply a missing manual ticket.
6. At `fs/write-intent` / `fs/edit-intent`, require the same authority, full argument/target/content fingerprint, backend identity, target key and unspent ticket. Preserve stronger observation-policy constraints. Supply `createIfAbsent` or `replaceIfVersion` to the official provider, then spend the ticket. The provider rejects tested stale writes even if another intent wrapper waits after approval.
7. Dispose pending approval requests and clear in-flight records when the plugin stops. Other permission modes, plugin unloading and already-running external processes are outside this policy. Do not unload/reconfigure standalone protection while work is in flight. The bundled desktop adds a persistent host prepare/dispatch/file-intent gate, binds each policy epoch, and rechecks at the registry body entry even when a wrapper replaces its cancellation signal.

Approval hashes cover complete arguments, not the old classifier's truncated/redacted representation. They remain local. Payloads over the complete-call limit are denied. No whole-workspace artifact scans occur. The adapted official review engine calls the active agent model once per admissible candidate, before any manual prompt. A strict closed JSON/stream parser, deadline and complete snapshot fingerprint make failure or changed inputs a denial. The review ticket expires after 120 seconds and is deleted at the call result. Old `ArtifactRegistry` and `AutoApprovalGrants` exports are non-authorizing compatibility shims; standalone legacy classifier utilities are not invoked by `apply`.

## Audit findings and changes

The baseline allowed arbitrary build/install/script execution and unknown plugin tools, inferred authorization through model classification, and promoted session artifacts into automatic deletion eligibility. Extension aliases such as `curl.exe`, Git options before subcommands, inline Node/Python and long-command tails demonstrated why lexical classification cannot establish runtime effects.

Independent adversarial review reproduced a preset-change/pre-execute-wrapper bypass and a `file_path` versus `path` confusion with the real string editor. These are covered by regressions. The review also demonstrated that a host around-tool wrapper can call the body twice after a single guard; dispatch and filesystem commit checks now enforce one spent approval in tested wrappers.

## Trusted computing base and remaining boundaries

The trusted base includes the configured 0.1.5-rc.1 Harness composition, actual tool implementations, local filesystem provider, approval service and human-facing answerer. A same-name scoped tool can be replaced by a plugin, and a different answerer can fabricate `allowed-once`; this API provides no cryptographic human-attestation channel. This plugin does not defend against arbitrary malicious code in the host process.

File identity/hash and provider version checks are not kernel-level path capabilities. Content changes to the same file or directory replacement by an external process after the last check, OS/backend defects, hostile volumes, compromised plugins, direct filesystem calls, startup lifecycle scripts, disabled/unloaded protection and actions outside Auto cannot be eliminated here. Independent review reproduced an external same-file write during the official provider’s temporary-file publication hook being overwritten despite replaceIfVersion. The version check occurs before final publication; it is not an OS-level compare-and-swap. No claim of absolute safety is made. A plugin load error can leave host UI configuration visible; stop the session on backend load failure. A future executor must be independently isolated and validated before any arbitrary execution is re-enabled, with no host disk shares or credentials and explicit controlled output import.

## Public evidence and sources

The following are **public user reports**, open when retrieved on 2026-09-17. They are not vendor-confirmed findings, independently verified incident histories, or prevalence estimates. We did not reproduce destructive commands on real data.

| Source | Reported mechanism | Design consequence |
| --- | --- | --- |
| [Codex #43343](https://github.com/openai/codex/issues/43343) | Windows cleanup fallback into nested CMD quoting reportedly broadened deletion beyond the project | Block all shell cleanup and cross-shell fallbacks |
| [Codex #42355](https://github.com/openai/codex/issues/42355) | `git clean -fdX` on ignored nested paths reportedly removed an ignored parent with secrets | No automatic Git cleanup or inferred target scope |
| [Claude Code #94453](https://github.com/anthropics/claude-code/issues/94453) | A copy task reportedly became unrequested PowerShell destination deletion | Copy/build intent never implies deletion authority |
| [Claude Code #82165](https://github.com/anthropics/claude-code/issues/82165) | Outer-shell expansion reportedly transformed nested cleanup into broad removal with writable WSL Windows mounts | No interpreter allowlist; no shared writable host drives in any future executor |
| [Claude Code #91599](https://github.com/anthropics/claude-code/issues/91599) | A clarification was reportedly mistaken for external-drive wipe authorization | Conversation text cannot mint approvals |

`Remove-Item` generally does not use the Recycle Bin; `-Force` is not the determining distinction. A search of the public DeepSeek Harness issues did not find a directly corroborated Windows deletion incident; that is not evidence of absence, particularly because upstream also uses Discussions.

Official guidance distinguishes approval from enforced isolation: [OpenAI Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox), [OpenAI agent approvals/security](https://learn.chatgpt.com/docs/agent-approvals-security), [Claude sandboxing](https://code.claude.com/docs/en/sandboxing), [Claude permissions](https://code.claude.com/docs/en/permissions). The examined Harness Windows ACL backend documents ambient Everyone-write/hard-link gaps and no read/network confinement. Consequently the plugin does not treat workspace-write alone as a proof that arbitrary code preserves user data.
