import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SandboxBashExecutor from '@deepseek-ai/dsh-bash-sandbox'
import * as ShellEnv from '@deepseek-ai/dsh-shell-env'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'
import * as ToolStrReplaceEditor from '@deepseek-ai/dsh-tool-str-replace-editor'
import ToolRuntime, { type ToolExecutionInput, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import * as AutoMode from '../src/index.js'
import type { ClassifierInput } from '../src/types.js'
import { provideTestPermissionPresets } from './harness.js'

const seatbeltProbe = process.platform === 'darwin'
  ? spawnSync('sandbox-exec', ['-p', '(version 1) (allow default)', '--', 'true'], { timeout: 5_000, stdio: 'ignore' })
  : undefined
const realSandboxAvailable = process.platform === 'darwin' && seatbeltProbe?.status === 0

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

interface BusinessHarness {
  readonly context: Context
  readonly workspace: string
  readonly outside: string
  readonly classifierCalls: ClassifierInput[]
  readonly events: Array<{ type: string; data?: Record<string, unknown> }>
  run(callId: string, command: string, options?: { escalate?: boolean }): Promise<ToolExecutionResult>
  runEditor(callId: string, argumentsValue: Record<string, unknown>): Promise<ToolExecutionResult>
}

const contexts: Context[] = []
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(context => context.fiber.dispose()))
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

interface BusinessPaths {
  readonly workspace: string
  readonly outside: string
}

async function createBusinessHarness(userMessage: string | ((paths: BusinessPaths) => string)): Promise<BusinessHarness> {
  const { default: LocalSubprocessRuntime } = await import('@deepseek-ai/dsh-subprocess-local')
  const workspace = await mkdtemp(join(homedir(), 'dsh-auto-business-workspace-'))
  const outside = await mkdtemp(join(homedir(), 'dsh-auto-business-outside-'))
  tempDirs.push(workspace, outside)
  const classifierCalls: ClassifierInput[] = []
  const events: Array<{ type: string; data?: Record<string, unknown> }> = [
    { type: 'turn/start' },
    { type: 'permission/preset', data: { preset: 'auto' } },
    { type: 'sandbox/mode', data: { mode: 'workspace-write' } },
    { type: 'approval/policy', data: { policy: 'ask' } },
    {
      type: 'user/message',
      data: {
        id: 'business-user-message',
        role: 'user',
        content: [{ type: 'text', text: typeof userMessage === 'function' ? userMessage({ workspace, outside }) : userMessage }],
        source: { kind: 'user' },
      },
    },
  ]
  const context = new Context()
  provideTestPermissionPresets(context)
  contexts.push(context)
  context.provide('agents', { get: () => undefined })
  context.provide('llm', {
    stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      const block = options.messages[0]?.content[0]
      const input = JSON.parse(block?.type === 'text' ? block.text : '{}') as ClassifierInput
      classifierCalls.push(input)
      const command = (input.arguments as { command?: string } | undefined)?.command ?? ''
      const directMessages = input.trustedUserMessages.join('\n')
      const deletionEffects = input.filesystemEffects?.filter(effect => effect.kind === 'delete') ?? []
      const explicitDeletion = deletionEffects.length > 0
        && deletionEffects.every(effect => directMessages.includes(effect.path))
        && /(?:删除|永久删除|delete|remove)/i.test(directMessages)
      const createOnlyOutsideEffect = input.filesystemEffects !== undefined
        && input.filesystemEffects.length > 0
        && input.filesystemEffects.every(effect => effect.kind === 'create-or-overwrite' && !effect.existedBefore)
      const reversibleOutsideTask = input.sandboxRequest !== undefined
        && command.includes(outside)
        && directMessages.includes(outside)
        && /(?:导出|写入|复制|export|write|copy|save)/i.test(directMessages)
        && createOnlyOutsideEffect
      const explicitOutsideOverwrite = input.sandboxRequest !== undefined
        && command.includes(outside)
        && directMessages.includes(outside)
        && /(?:覆盖|替换|overwrite|replace)/i.test(directMessages)
        && input.filesystemEffects?.some(effect => effect.kind === 'create-or-overwrite' && effect.existedBefore) === true
      const requestedGitCommit = /\bgit\s+commit\b/i.test(command) && /(?:提交|commit)/i.test(directMessages)
      const requestedInstall = /\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|i)\b/i.test(command)
        && /(?:安装|install|dependency)/i.test(directMessages)
      const requestedTransmission = /\bcurl\b/i.test(command)
        && /(?:发送|上传|send|post|upload)/i.test(directMessages)
      const broadDeletion = /\bgit\s+clean\b|\bfind\b[^\n]*(?:-delete|-exec\s+rm)/i.test(command)
      const allow = !broadDeletion && (explicitDeletion || reversibleOutsideTask || explicitOutsideOverwrite || requestedGitCommit || requestedInstall || requestedTransmission)
      const needsAuthorization = input.sandboxRequest !== undefined
        || deletionEffects.length > 0
        || broadDeletion
        || /\bgit\s+commit\b/i.test(command)
        || /\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|i)\b/i.test(command)
        || /\bcurl\b/i.test(command)
      const decision = allow
        ? { decision: 'allow', reason: 'the direct task authorizes this exact bounded business effect' }
        : needsAuthorization
          ? { decision: 'deny', reason: 'the risky effect lacks the required exact direct-user authority' }
          : { decision: 'allow', reason: 'routine sandbox-contained development' }
      return (async function* () {
        yield { type: 'text-delta', index: 0, text: JSON.stringify(decision) } as const
        yield { type: 'finish', reason: { kind: 'stop' } } as const
      })()
    },
  })
  await context.plugin(SystemPrompt)
  await context.plugin(ToolRuntime)
  await context.plugin(ApprovalService, { policy: 'ask' })
  await context.plugin(LocalSandboxProvider, {})
  await context.plugin(SessionProjectionRegistry)
  await context.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: workspace })
  await context.plugin(SandboxedFileSystem, { cwd: workspace })
  await context.plugin(LocalSubprocessRuntime)
  await context.plugin(SandboxBashExecutor, { cwd: workspace, timeoutMs: 30_000 })
  await context.plugin(ShellEnv)
  await context.plugin(ToolBash, { enableRunInBackground: false })
  await context.plugin(ToolStrReplaceEditor, {})
  await context.plugin(AutoMode, { modelReview: false, workspaceRoot: workspace, dshHome: join(workspace, '.dsh') })

  const sessionId = 'business-session'
  const agent = {
    id: sessionId,
    options: { provider: 'mock-provider', model: 'mock-model' },
    session: {
      id: sessionId,
      header: { version: 0, id: sessionId, createdAt: 0, cwd: workspace },
      events,
      get seq() { return events.length },
      eventAt(index: number) { return events[index] === undefined ? undefined : { ...events[index], seq: index } },
      snapshotEvents(from = 0, to = events.length) { return events.slice(from, to) },
      requestHeader: () => ({ config: { provider: 'mock-provider', model: 'mock-model' } }),
      append(type: string, data: Record<string, unknown>) {
        const event = { type, data }
        events.push(event)
        return event
      },
    },
  } as unknown as NonNullable<ToolExecutionInput['agent']>

  return {
    context,
    workspace,
    outside,
    classifierCalls,
    events,
    run(callId, command, options = {}) {
      return context.tools.execute({
        callId: ToolCallId(callId),
        name: 'bash',
        arguments: {
          command,
          description: 'business scenario command',
          ...(options.escalate === true ? {
            sandbox_permissions: 'danger-full-access',
            justification: `write the explicitly requested external fixture ${outside}`,
          } : {}),
        },
        agent,
        signal: new AbortController().signal,
      })
    },
    runEditor(callId, argumentsValue) {
      return context.tools.execute({
        callId: ToolCallId(callId),
        name: 'str_replace_editor',
        arguments: argumentsValue,
        agent,
        signal: new AbortController().signal,
      })
    },
  }
}

describe.skipIf(!realSandboxAvailable)('Auto business flows through the real macOS workspace sandbox', () => {
  it.each([false, true])('blocks unisolated shell execution even when escalation=%s', async escalate => {
    const harness = await createBusinessHarness('I authorize all cleanup and wider execution.')
    const target = join(harness.workspace, 'existing.txt')
    await writeFile(target, 'keep')
    for (const command of [`rm -f ${shellQuote(target)}`, `printf overwritten > ${shellQuote(target)}`, 'npm install', 'python cleanup.py']) {
      const result = await harness.run('blocked', command, { escalate })
      expect(result.isError).toBe(true)
      expect(await readFile(target, 'utf8')).toBe('keep')
    }
    expect(harness.classifierCalls).toEqual([])
  })
})
