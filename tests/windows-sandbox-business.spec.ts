import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SandboxPwshExecutor from '@deepseek-ai/dsh-pwsh-sandbox'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as ShellEnv from '@deepseek-ai/dsh-shell-env'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolPwsh from '@deepseek-ai/dsh-tool-pwsh'
import ToolRuntime, { type ToolExecutionInput, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import * as AutoMode from '../src/index.js'
import type { ClassifierInput } from '../src/types.js'
import { provideTestPermissionPresets } from './harness.js'

const nativeWindowsPwsh = process.platform === 'win32'
  && spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$true'], {
    timeout: 5_000,
    stdio: 'ignore',
  }).status === 0

function pwshQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

interface WindowsHarness {
  readonly workspace: string
  readonly outside: string
  readonly classifierCalls: ClassifierInput[]
  readonly events: Array<{ type: string; data?: Record<string, unknown> }>
  run(callId: string, command: string, options?: { escalate?: boolean }): Promise<ToolExecutionResult>
}

const contexts: Context[] = []
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(context => context.fiber.dispose()))
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function createWindowsHarness(userMessage: string | ((outside: string) => string)): Promise<WindowsHarness> {
  const { default: LocalSubprocessRuntime } = await import('@deepseek-ai/dsh-subprocess-local')
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-auto-windows-workspace-'))
  const outside = await mkdtemp(join(tmpdir(), 'dsh-auto-windows-outside-'))
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
        id: 'windows-business-user-message',
        role: 'user',
        content: [{ type: 'text', text: typeof userMessage === 'function' ? userMessage(outside) : userMessage }],
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
      const createOnlyOutside = input.filesystemEffects !== undefined
        && input.filesystemEffects.length > 0
        && input.filesystemEffects.every(effect => effect.kind === 'create-or-overwrite' && !effect.existedBefore)
        && directMessages.includes(outside)
        && /(?:导出|写入|export|write|save)/i.test(directMessages)
      const authorizedEscalation = input.sandboxRequest !== undefined
        && (createOnlyOutside || input.trustedUserMessages.some(message => message.includes(outside) && /授权|authoriz/i.test(message)))
      const decision = authorizedEscalation
        ? { decision: 'allow', reason: 'the direct user authorized this exact Windows fixture write' }
        : input.sandboxRequest !== undefined || /remove-item/i.test(command)
          ? { decision: 'deny', reason: 'the Windows side effect lacks exact direct-user authorization' }
          : { decision: 'allow', reason: 'routine workspace-contained PowerShell' }
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
  await context.plugin(LocalSubprocessRuntime)
  await context.plugin(SandboxPwshExecutor, { cwd: workspace, timeoutMs: 30_000 })
  await context.plugin(ShellEnv)
  await context.plugin(ToolPwsh, { enableRunInBackground: false })
  await context.plugin(AutoMode, { modelReview: false, workspaceRoot: workspace, dshHome: join(workspace, '.dsh') })

  const sessionId = 'windows-business-session'
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
    workspace,
    outside,
    classifierCalls,
    events,
    run(callId, command, options = {}) {
      return context.tools.execute({
        callId: ToolCallId(callId),
        name: 'pwsh',
        arguments: {
          command,
          description: 'native Windows business scenario command',
          ...(options.escalate === true ? {
            sandbox_permissions: 'danger-full-access',
            justification: `write the explicitly requested Windows fixture ${outside}`,
          } : {}),
        },
        agent,
        signal: new AbortController().signal,
      })
    },
  }
}


describe.skipIf(!nativeWindowsPwsh)('Windows real PowerShell tool under protection-first Auto', () => {
  it.each([false, true])('blocks invocation even when escalation=%s and preserves the sentinel', async escalate => {
    const harness = await createWindowsHarness('I authorize cleanup, builds, and any wider execution.')
    const target = join(harness.workspace, 'existing.txt')
    await writeFile(target, 'keep')
    for (const command of [
      `Remove-Item -LiteralPath ${pwshQuote(target)} -Force`,
      `Set-Content -LiteralPath ${pwshQuote(target)} -Value overwritten`,
      '$x = 5; Write-Output $x', 'npm install', 'node ./cleanup.js',
    ]) {
      const result = await harness.run('windows-denied', command, { escalate })
      expect(result.isError, JSON.stringify(result)).toBe(true)
      expect(await readFile(target, 'utf8')).toBe('keep')
    }
    expect(harness.classifierCalls).toEqual([])
    expect(harness.events.filter(event => event.type === 'approval/asked')).toEqual([])
  }, 60_000)
})
