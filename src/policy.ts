import { lstatSync } from 'node:fs'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { ArtifactRegistry } from './artifacts.js'
import { patchGuardPaths, patchPayloadsForGuard } from './patch.js'
import {
  hardDestructiveTargetReason,
  isProtectedProjectPath,
  isWithin,
  type PolicyRoots,
} from './paths.js'
import { inspectStructuredPath } from './file-boundary.js'
import { assessShell, hardDenyShellReason } from './shell.js'
import type { Assessment } from './types.js'

function existedBefore(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function pathArgument(args: Record<string, unknown> | undefined): string | undefined {
  for (const key of ['file_path', 'path']) {
    const value = args?.[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

export function structuredFilePath(exec: Readonly<ToolExecution>, roots: PolicyRoots): string {
  const args = record(exec.arguments)
  const key = exec.name === 'str_replace_editor' ? 'path' : 'file_path'
  const path = args?.[key]
  if (typeof path !== 'string') throw Error(`missing exact ${key}`)
  return inspectStructuredPath(path, roots, ['write', 'edit'].includes(exec.name) ||
    (exec.name === 'str_replace_editor' && args?.command !== 'view')).path
}

function serializedArguments(argumentsValue: unknown): string {
  try {
    return JSON.stringify(argumentsValue)
  } catch {
    return ''
  }
}

function containsCredentialMaterial(argumentsValue: unknown): boolean {
  return /(?:BEGIN (?:[A-Z]+ )?PRIVATE KEY|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\b(?:sk|gh[opusr]|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b|Bearer\s+[A-Za-z0-9._~+\/-]{8,}|\.ssh[\\/](?:id_|config)|\.credentials\.yaml)/i
    .test(serializedArguments(argumentsValue))
}

function urlContainsCredential(value: string): boolean {
  try {
    const url = new URL(value, 'https://relative.invalid')
    if (url.password) return true
    return [...url.searchParams].some(([key, value]) => /^(?:token|access_token|api[_-]?key|sig|signature|auth|authorization)$/i.test(key) && value.length >= 8)
  } catch { return true }
}

/** One model-requested, tool-native widening of the standing workspace sandbox. */
export interface SandboxWideningRequest {
  readonly requestedMode: 'danger-full-access'
  readonly justification: string
}

/**
 * @deprecated Use `SandboxRequestState` / `sandboxRequestState` for new code.
 * Kept as a compatibility view for consumers of the pre-rc.2 export.
 */
export interface SandboxEscalationRequest {
  readonly requestedMode: string
  readonly justification: string
}

/** Semantic state of the raw sandbox fields before any authorization decision. */
export type SandboxRequestState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'redundant-standing' }
  | { readonly kind: 'widening'; readonly request: SandboxWideningRequest }
  | { readonly kind: 'invalid'; readonly requestedMode: unknown }

/** Classify the official sandbox request fields without treating them as authorization. */
export function sandboxRequestState(argumentsValue: unknown): SandboxRequestState {
  const args = record(argumentsValue)
  if (args === undefined || !Object.prototype.hasOwnProperty.call(args, 'sandbox_permissions')) {
    return { kind: 'absent' }
  }
  const requestedMode = args.sandbox_permissions
  if (typeof requestedMode !== 'string') return { kind: 'invalid', requestedMode }
  if (requestedMode === 'workspace-write') return { kind: 'redundant-standing' }
  if (requestedMode === 'danger-full-access') {
    return {
      kind: 'widening',
      request: {
        requestedMode,
        justification: typeof args?.justification === 'string' ? args.justification : '',
      },
    }
  }
  return { kind: 'invalid', requestedMode }
}

/** Read the legacy paired sandbox fields without treating them as authorization. */
export function sandboxEscalationRequest(argumentsValue: unknown): SandboxEscalationRequest | undefined {
  const args = record(argumentsValue)
  const requestedMode = args?.sandbox_permissions
  if (typeof requestedMode !== 'string') return undefined
  return {
    requestedMode,
    justification: typeof args?.justification === 'string' ? args.justification : '',
  }
}

function sensitiveReadPath(path: string): boolean {
  return /(?:^|[\\/])(?:\.ssh|\.gnupg|\.aws|\.azure|\.kube|\.config[\\/]gh|\.docker)(?:[\\/]|$)|(?:^|[\\/])(?:id_rsa|id_ed25519|credentials|credentials\.yaml|config\.json|\.env|\.npmrc|\.netrc|\.pypirc|netrc)(?:$|[.\\/])/i.test(path)
}

const DESTRUCTIVE_TOOL = /(?:^|[_-])(?:delete|destroy|remove|erase|purge|drop|truncate|wipe|unlink|rmdir|reset|revoke)(?:$|[_-])/i
const EXTERNAL_WRITE_TOOL = /(?:^|[_-])(?:deploy|publish|push|upload|send|post|release|merge|submit|create[-_]?(?:issue|pull[-_]?request))(?:$|[_-])/i

/** Read-only tools backed by owner/workspace-authorized Harness services. */
const HARNESS_READ_TOOLS = new Set([
  'job_output',
  'job_list',
  'schedule_list',
  'session_search',
  'session_event_search',
  'session_trace',
  'session_event_trace',
  'session_event_read',
  'terminal_read',
  'terminal_list',
])

/** Lifecycle controls that stop only owner-scoped background work. */
const OWNER_CONTROL_TOOLS = new Set([
  'job_kill',
  'terminal_close',
])

/** Synchronous hard-deny reason suitable for the monotonic tool guard. */
export function hardDenyReason(exec: Readonly<ToolExecution>, roots: PolicyRoots): string | undefined {
  const args = record(exec.arguments)
  if ((/^(?:web_fetch|curl|wget)/i.test(exec.name) || EXTERNAL_WRITE_TOOL.test(exec.name)) && containsCredentialMaterial(exec.arguments)) {
    return 'external call contains credential or private-key material'
  }
  if ((/^(?:web_fetch|curl|wget)/i.test(exec.name) || EXTERNAL_WRITE_TOOL.test(exec.name))
    && typeof args?.url === 'string' && urlContainsCredential(args.url)) {
    return 'external URL contains credential material or cannot be safely parsed'
  }
  if (exec.name === 'apply_patch') {
    for (const path of patchPayloadsForGuard(exec.arguments).flatMap(patchGuardPaths)) {
      const reason = hardDestructiveTargetReason(path, roots)
      if (reason !== undefined) return `apply_patch targets ${reason}`
    }
  }
  if ((exec.name === 'bash' || exec.name === 'pwsh') && typeof args?.command === 'string') {
    return hardDenyShellReason(args.command, exec.name, roots)
  }
  if (['write', 'edit', 'apply_patch'].includes(exec.name)
    || (exec.name === 'str_replace_editor' && args?.command !== 'view')) {
    const path = pathArgument(args)
    if (path !== undefined) {
      const reason = hardDestructiveTargetReason(path, roots)
      if (reason !== undefined) return `mutation targets ${reason}`
    }
  }
  if (DESTRUCTIVE_TOOL.test(exec.name)) {
    const path = pathArgument(args)
    if (path !== undefined) {
      const reason = hardDestructiveTargetReason(path, roots)
      if (reason !== undefined) return `destructive plugin tool targets ${reason}`
    }
  }
  return undefined
}

/** Deterministic first-pass classification for every normal tool call. */
export function assessTool(exec: Readonly<ToolExecution>, roots: PolicyRoots, artifacts?: ArtifactRegistry): Assessment {
  const hard = hardDenyReason(exec, roots)
  if (hard !== undefined) return { decision: 'deny', reason: hard, classifierEligible: false }
  const sandbox = sandboxRequestState(exec.arguments)
  if (sandbox.kind !== 'absent') {
    return { decision: 'deny', reason: 'Auto does not grant sandbox escalation; remove redundant sandbox fields for ordinary structured tools', classifierEligible: false }
  }
  const args = record(exec.arguments)
  if (exec.name === 'bash' || exec.name === 'pwsh') {
    return typeof args?.command === 'string'
      ? assessShell(args.command, exec.name, roots, artifacts, exec.agent?.session)
      : { decision: 'deny', reason: 'shell command is missing or invalid', classifierEligible: false }
  }
  const path = pathArgument(args)
  if (typeof args?.path === 'string' && typeof args?.file_path === 'string' && args.path !== args.file_path) return { decision: 'deny', reason: 'ambiguous target fields', classifierEligible: false }
  const view = exec.name === 'str_replace_editor' && args?.command === 'view'
  if (['read', 'read_image'].includes(exec.name) || view) {
    if (path === undefined || path.trim() === '') return { decision: 'deny', reason: 'read target is missing', classifierEligible: false }
    let normalized: string
    try { normalized = structuredFilePath(exec, roots) }
    catch (error) { return { decision: 'deny', reason: `unverifiable file boundary: ${String(error)}`, classifierEligible: false } }
    if (!isWithin(roots.workspace, normalized) || sensitiveReadPath(normalized)) {
      return { decision: 'ask', reason: 'reading outside the workspace or reading credentials requires exact manual approval', classifierEligible: false }
    }
    return { decision: 'allow', reason: 'structured workspace file read', classifierEligible: false }
  }
  if (['grep', 'glob'].includes(exec.name)) {
    return { decision: 'deny', reason: 'recursive search cannot verify every link and credential boundary; use exact structured file reads', classifierEligible: false }
  }
  if (['write', 'edit', 'str_replace_editor'].includes(exec.name)) {
    if (path === undefined || path.trim() === '') return { decision: 'deny', reason: 'mutation target is missing', classifierEligible: false }
    if (exec.name === 'str_replace_editor' && !['create', 'str_replace', 'insert'].includes(String(args?.command))) {
      return { decision: 'deny', reason: 'unrecognized editor operation', classifierEligible: false }
    }
    let normalized: string
    try { normalized = structuredFilePath(exec, roots) }
    catch (error) { return { decision: 'deny', reason: `unverifiable file boundary: ${String(error)}`, classifierEligible: false } }
    if (!isWithin(roots.workspace, normalized) || isProtectedProjectPath(normalized, roots) || sensitiveReadPath(normalized)) {
      return { decision: 'deny', reason: 'Auto cannot mutate outside-workspace files, credentials or executable security metadata', classifierEligible: false }
    }
    return {
      decision: 'ask', reason: 'exact structured file modification requires manual approval; no model or conversation text can grant it', classifierEligible: false,
      filesystemEffects: [{ kind: 'create-or-overwrite', path: normalized, existedBefore: existedBefore(normalized) }],
    }
  }
  if (['ask_user_question', 'todo_write', 'get_goal', 'create_goal', 'update_goal', 'report'].includes(exec.name)
    || HARNESS_READ_TOOLS.has(exec.name) || OWNER_CONTROL_TOOLS.has(exec.name)) {
    return { decision: 'allow', reason: 'trusted Harness inspection or session control without arbitrary code execution', classifierEligible: false }
  }
  return { decision: 'deny', reason: `Auto has no verified non-destructive execution contract for tool: ${exec.name}`, classifierEligible: false }
}

/** Full file identity included in the exact manual approval, never in model input. */
export function fileApprovalIdentity(exec: Readonly<ToolExecution>, roots: PolicyRoots): string | undefined {
  if (!['read', 'read_image', 'write', 'edit', 'str_replace_editor'].includes(exec.name)) return undefined
  const args = record(exec.arguments)
  const path = structuredFilePath(exec, roots)
  const mutation = ['write', 'edit'].includes(exec.name) || (exec.name === 'str_replace_editor' && args?.command !== 'view')
  return inspectStructuredPath(path, roots, mutation).identity
}
