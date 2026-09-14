# 0.1.9 acceptance

Production and real API acceptance completed before this commit. Every run used the existing `/tmp` workspace (macOS resolves it to `/private/tmp`), so no workspace picker was involved. The npm candidate was packed from the frozen tree with Node **24.20.0** and npm **11.19.0** — the same toolchain the publish workflow uses — and that pack reproduced the CI tarball hash byte-for-byte. Its SHA-256 is:

`1094c9fae16f7ff94164cba70bcb2160837978d31014b79537d3f00c1f12e464`

## Automated and product checks

- `pnpm verify`: **190 passed**, five Windows-only tests skipped on macOS; typecheck, server/client build and package contract passed.
- Maintenance contract: five exact host versions and 120 unchanged upstream skill files verified.
- Doctor: **7 tests passed**, including mixed versions, duplicate identities, nested copies, modified module bytes, extra modules, profile metadata and Windows tar CRLF output.
- Official CLI product fixture: **22 assertions per host on all five hosts**, with all 69 packaged files matched against the same tarball. `0.1.5-rc.1` resolves a 231-package DSH cohort; the `0.1.2.*` hosts resolve 214/215. Runtime services and actual Session objects share the expected module identity. The model in this suite is explicitly a deterministic fixture.

[Product fixture evidence](validation/0.1.9/fixture.json)

## Real API in Harness

Run against the exact `0.1.5-rc.1` cohort with the configured real `deepseek-official` provider and the model id read from the running host settings (`deepseek-flash`). **30 checks passed** over 20 requests (118,339 total tokens), 3 of them classifier calls.

| Exact host / composition | Requests | Result |
| --- | ---: | --- |
| `0.1.5-rc.1`, headless | 20 | Passed |

Exercised on the real provider: native `str_replace_editor` create/replace/view; an explicitly authorized deletion approved by the real classifier; a redundant `sandbox_permissions: workspace-write` request denied with the Auto recovery marker followed by a successful field-less retry (**the recovery branch was actually exercised, not merely attempted**); the real classifier refusing an unauthorized deletion and resisting argument-level authority injection; the Auto boundary guidance present on every agent request (the remaining requests are session-title calls with no tools); and an untouched sibling sentinel. [Real API evidence](validation/0.1.9/real-api.json)

Two harness changes required acceptance-tooling adaptation, not policy changes: `0.1.5-rc.1` removed `str_replace_editor` from the base composition, so the acceptance profile mounts the official `@deepseek-ai/dsh-tool-str-replace-editor` package explicitly; and the model id is now read from the host settings instead of a hard-coded `deepseek-v4-flash`. The boundary-guidance probe was also repaired — it previously matched a string the guidance never contained and so always reported false.

### Web UI in a real browser

Driven through the actual Web UI in Ego Lite against the same exact `0.1.5-rc.1` cohort and real provider. The session was created from the UI (the web profile composes agent-plane tools from the `standard` agent preset, so the headless driver's `ctx.agents.create()` does not see them) with the workspace registered by `scripts/acceptance/web-observer.mjs`, matching the 0.1.7 method.

Checked: the access-mode menu renders all four presets in Chinese with the Auto row marked by the injected icon; the risk acknowledgement dialog appears in Chinese with its confirmation disabled until the checkbox is ticked; cancelling leaves the previous preset selected; confirming selects Auto; a real prompt then deleted an explicitly authorized `/tmp` file through a `bash` call plus **one real classifier request**, with a sibling file left intact and no manual approval; and Auto plus the injected marker both survive a page reload. [Web evidence](validation/0.1.9/web.json)

## Adversarial review and boundaries

The plugin's host-facing surface (permission preset projection, tool guard and pipeline events, approval seam, system-prompt context, session event reader, locale service) is unchanged across `0.1.2-rc.1` → `0.1.5-rc.1`, which the exact-artifact fixture run confirms: **no runtime source change was needed for the new host**. The differences are confined to the dependency cohort, the default tool composition and the default model id.

This remains the project's bounded, sandbox-first policy. Ordinary opaque shell content may still run inside the write sandbox; parsed dynamic interpreter/assignment checks do not prove the semantics of every possible shell expression. The write sandbox does not constrain all reads or network effects. Third-party patch executors remain manual because no official sandbox contract was verified for them.

Not performed on this machine: PowerShell and Windows ACL acceptance, and live user-data migration. Windows coverage runs in the CI matrix. The Web client bundle is byte-identical to `0.1.7` (`8d819f59…bec62a`), and it was exercised in a real browser as described above.

Raw logs and credentials remain outside Git and npm. The committed JSON contains sanitized summaries only.
