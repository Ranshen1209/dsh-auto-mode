# dsh-auto-mode: preservation first

Maintained [Ranshen1209 fork](https://github.com/Ranshen1209/dsh-auto-mode) of [NanmiCoder/dsh-auto-mode](https://github.com/NanmiCoder/dsh-auto-mode), based on 0.1.9. Candidate **0.3.0-alpha.1** deliberately changes the original unattended-approval contract. Upstream npm 0.1.9 does not contain these fixes. [中文说明](README_ZH.md).

## Policy

- Review every structurally admissible call with the active agent provider/model. Allow verified ordinary reads and audited session controls only after that fresh risk and authorization decision. Never cache an allowance across calls.
- Require a fresh official manual approval for each structured file modification and sensitive workspace read. Bind the complete arguments, call identity, permission history, target identity/content and backend file version. An approved edit can overwrite content; review the full call.
- Block shells, scripts, builds, installers, deletion/cleanup, opaque patch tools, external agents/workflows, stateful terminal execution, unknown tools and sandbox widening. No independently isolated execution broker is available.
- Reject links/junctions, hard-linked files, ambiguous Windows aliases, ADS/device paths, outside-workspace files, root targets and security metadata mutations. Fail closed on inaccessible ancestors. Exact file review is limited to 16 MiB; creation requires an existing parent. Recursive search is currently disabled.
- A model decision, old chat message, justification or same-session artifact never grants authority. Official Auto review snapshotting is combined with deterministic preservation checks; model output is a veto, never Full access. Review failures, malformed responses, cancellation and timeouts deny the call. Workspace artifact discovery has been removed. Legacy classifier configuration is ignored; automatic grant/cleanup compatibility classes are inert.

Each review uses the official source-role separation: human instructions, direct-parent scope, project constraints, checkpoints and facts. Tool outputs and assistant claims do not grant authority. Review results bind the full pending call, schema/model route, visible instruction history, permission history and current file identity; changes or a 120-second lifetime invalidate the result. Hard-denied actions are rejected before contacting a model. Ordinary calls incur one extra model request and its latency/cost.

## Scope and limitations

This is a tool-pipeline policy, **not an absolute deletion guarantee or an OS sandbox**. It requires an active backend and Auto preset, the exact verified host cohort, trusted tool implementations, filesystem provider and approval answerers. Same-name tool replacement, direct plugin filesystem access, pre-load package scripts, compromised hosts, mode switching, plugin unloading/HMR and external processes are outside the guarantee. A visible Auto label alone does not prove the backend is active.

The official filesystem conditional-write API adds version checks and the plugin prevents tested approval replays, but this does not create an atomic kernel path capability. External content changes to the same file, or directory replacement, between the last check and OS operation can still be overwritten; these remain host/filesystem concerns. Windows ACL sandboxing is not complete read/network/write confinement. Arbitrary execution would require a separately verified disposable VM/container with no sensitive mounts, host credentials or shared writable drives; this candidate has no such broker.

## Compatibility and development

The standalone candidate targets coherent **Harness 0.1.5-rc.1**. The desktop integration targets **0.1.6-alpha.1.desktop.2**; its product validation is tracked separately in [VALIDATION.md](VALIDATION.md). Older hosts, mixed cohorts and the custom `desktop.5` build are not automatically supported. Validate this fork's packed `.tgz` in an isolated Profile. The candidate is not published to npm. Desktop bundles a private source copy and enables `enforceAllSessions: true` with `modelReview: true`; saved permission selections cannot remove its protection.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run typecheck
pnpm run build
pnpm test
node scripts/verify-package.mjs
```

Tests use owned disposable sentinels. Windows execution requires read access to ancestor identities; missing access must remain a denial. See [DESIGN.md](DESIGN.md) for the security contract and sources, [VALIDATION.md](VALIDATION.md) for evidence and unverified boundaries, and [RELEASE_NOTES.md](RELEASE_NOTES.md) for migration notes. Historical evidence under `docs/` describes old releases, not this candidate.

Original authorship and contribution history are preserved. [MIT](LICENSE).

The review engine is adapted under MIT from DeepSeek Harness `dsh-v0.1.6-alpha.1` (`0a15e36e7f82b6ed45af6fa9759f29b40dcd965d`), with its [license](src/upstream-review/LICENSE) preserved. The official Full-access grant/lifecycle is deliberately excluded.
