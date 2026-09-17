# Security candidate validation

Candidate: 0.3.0-alpha.1. Baseline: upstream 0.1.9, commit `d86510931301bbd0674a58b56a1ab44c28c28294`. Target: coherent Harness 0.1.5-rc.1 on Windows, Node 24.19.0. Dependency lifecycle scripts were disabled during installation. The identity doctor resolves 231 Harness packages in one matching cohort, with no issues or warnings.

The initial policy-only regression corpus exposed 28 failures out of 30 cases on the permissive baseline. No destructive command was executed. This corpus now denies unisolated execution and never grants classifier authority.

The latest full Windows run passed **285 tests**, with **2 macOS-only cases skipped** and **0 failures**. Both server/client typechecks, production build and the package contract check passed. The updated suite covers historical Bash/PowerShell command forms, protected paths and aliases, real ToolRuntime/Loader composition, stale/replayed/cancelled manual approvals, mode-change listeners, parameter confusion, link/junction/hard-link denial, and the official ApprovalService + file tools + local provider. Real file effects are asserted outside the agent. The Windows native PowerShell tool composition rejects execution before the process body, preserving a test-owned sentinel. These checks do not certify native ACL confinement because no shell is allowed to start.

Independent adversarial review reproduced the mode-change bypass, the editor parameter confusion, and the host's guard-once/body-twice behavior. Dedicated regression tests now cover the fixes, including conditional writes at the actual filesystem seam.

The packed candidate passed all 20 product-entry assertions, using the real CLI and 231 matched host packages. Packaged product acceptance uses `scripts/harness-runtime-verify.mjs`, an isolated Profile/home, the real Harness CLI and an explicitly synthetic model/approval answerer. It must verify successful exact approved file edits, rejected writes, blocked shell/escalation/delegation, durable approval events, unchanged protected sentinel and seven fresh model-review requests, including deny/invalid/error responses. This is not a live-model or human UI acceptance.

Current hybrid product evidence is at Cervine `artifacts/dsh-auto-mode/hybrid-product-final-rc1/result.json`; earlier policy evidence is under `artifacts/dsh-auto-mode/security-hardening-20260917`, including baseline/final test JSON, dependency identity reports, public incident metadata, packed-artifact hashes and product-entry results. Build/test outputs are not committed into this repository. The authoritative task entry is `workspace/当前工作总览.md`.

Unverified: macOS/Linux execution, live provider APIs, interactive browser/human approval presentation, pending desktop 0.1.6-alpha.1.desktop.1 packaged integration, older Harness cohorts, hostile filesystem/OS races, malicious host/plugins and installation into a user's existing Profile. Historical `docs/` and older release evidence describe their original code only and must not be used to certify this candidate.

Desktop integration is still in progress. Registry/host regression currently passes 431 tests, including prepare-to-dispatch unload/reload and replacement of wrapper cancellation signals. This does not certify the unfinished desktop package or a real provider decision.
