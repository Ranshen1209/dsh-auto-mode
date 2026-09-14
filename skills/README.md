# DSH maintenance skills

Nine maintenance skills are vendored unchanged from [oh-my-dsh/dsh-plugin-upgrade-skill](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/tree/ecab245c6c1831c51b0240aca13573b94a6e525e), pinned to commit `ecab245c6c1831c51b0240aca13573b94a6e525e` (updated 2026-09-10, 120 upstream files). `upstream-lock.json` pins that source commit and the SHA-256 of every file; the accompanying MIT license is retained. `.agents/skills` links to these canonical copies. They are development guidance, not npm runtime dependencies and not part of the npm `files` list.

`dsh-plugin-development` is maintained by this project separately; it is not covered by the upstream hash manifest. Its historical API examples carry a scope warning and must be re-verified against the target tag before use.

Update by reviewing a pinned commit's diff, then copying the skill directories and refreshing `upstream-lock.json`, the mirror symlinks and this provenance note. Never track upstream `main` automatically.

## Usage entry points

| Task | Skill | Use |
| --- | --- | --- |
| Orchestration | [plugin-workflow](plugin-workflow/SKILL.md) | Organize phases, acceptance items and status; never assume a phase passed |
| Version impact and migration | [plugin-upgrade](plugin-upgrade/SKILL.md) | Version change chain, read-only scan, migration plan and implementation verification |
| Official contract audit | [dsh-upgrade-audit](dsh-upgrade-audit/SKILL.md) | Exact tag/source or npm artifact comparison that fills gaps in the version cards |
| Product and package testing | [plugin-test](plugin-test/SKILL.md) | Seven touchpoint classes, real host loading, tarball smoke and custom feature probes |
| Packaging and release | [plugin-release](plugin-release/SKILL.md) | Artifact closure and publication consistency; project rules below still apply |
| Writing plugins | [plugin-write](plugin-write/SKILL.md) | Target interface, naming, configuration and development templates |
| Runtime diagnosis | [plugin-runtime-debug](plugin-runtime-debug/SKILL.md) | Actual loaded versions, services, UI and state |
| Full plugin handbook | [dsh-plugin-development](dsh-plugin-development/SKILL.md) | Host/client architecture, bundle and profile contracts, client build, distribution |
| Heavy frontend dependencies | [plugin-heavy-dep](plugin-heavy-dep/SKILL.md) | Chunking, loading and interaction boundaries on demand |
| Migration benchmarks | [dsh-benchmark-case](dsh-benchmark-case/SKILL.md) | Turn a real failure into a Harbor task; running it needs the upstream benchmark repository |

A same-named global skill may come from another source or version; project tasks read the project paths in the table above. The user may authorize the complete lifecycle in one request, so generic skill confirmation templates do not require repeating that approval. Browser work uses Ego Lite; model acceptance uses a real provider and the existing `/tmp` workspace.

## Project rules

Project rules override the historical examples in the vendored skills.

1. **Version cards are leads, not a complete API diff.** The cards stop at `0.1.3-alpha.2`; there is no card for `0.1.5-rc.1`. Always confirm against the exact official implementation and this project's lifecycle tests.
2. **Query the official registry and keep the full DSH cohort exact.** An exact CLI version does not pin every split package; a wide peer range is not a support promise. Use `scripts/harness-doctor.mjs` on the resolved graph.
3. **Declare support only for tested versions.** `compatibility.json`, `peerDependencies`, `overrides` and the CI matrix are enforced together by `scripts/verify-maintenance.mjs`.
4. **Old claims are not this project's policy.** The vendored text still says that all Alpha packages are unpublished, that wide peers imply support, or that deleting a Git tag rolls back npm. Preserve immutable releases; recover by installing a previously tested exact pair or by adjusting an npm dist-tag explicitly.
5. **New checkers carry their own version range.** `inject-lint` targets an older Alpha.2 knob and hard-codes the Cordis peer; do not downgrade this project to satisfy it. Amending or re-tagging published artifacts is never the repair path here — ship a new version instead.
6. **Unit tests, fixture models and HTTP 200 alone do not establish real API or Web compatibility.** Acceptance needs the actual Harness process, a real provider, and the `/tmp` workspace; browser evidence needs Ego Lite.
7. **Read-only scans hit maintenance material.** The planner will match the vendored skill examples; exclude them explicitly rather than reporting their hits as product risk.
