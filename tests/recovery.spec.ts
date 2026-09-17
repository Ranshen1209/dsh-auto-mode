import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId, type GenerateOptions, type StreamChunk, type ToolSchema } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool, type PreToolDecision, type ToolExecutionInput, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as AutoMode from '../src/index.js'
import { provideTestPermissionPresets } from './harness.js'
import type { ClassifierDecision, ClassifierInput } from '../src/types.js'

/**
 * Preservation regressions through the real tool pipeline. The instrumented
 * classifier must never receive authority, regardless of chat authorization.
 * The shell body only records strings; test-owned sentinels must survive.
 */

const AUTHORIZATION = /(?:授权|authoriz|approve|go ahead)/i

function bashQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/** Deterministic stand-in for the independent model classifier. */
function classifierDecision(input: ClassifierInput): ClassifierDecision {
  const command = (input.arguments as { command?: string } | undefined)?.command ?? ''
  const match = /rm -rf (?:'([^']*)'|(\S+))/.exec(command)
  const deletion = match?.[1] ?? match?.[2]
  if (deletion === undefined) return { decision: 'allow', reason: 'routine development command' }
  const authorized = input.trustedUserMessages.some(message => AUTHORIZATION.test(message) && message.includes(deletion))
  return authorized
    ? { decision: 'allow', reason: 'the user authorized this exact deletion target' }
    : { decision: 'deny', reason: 'no trusted user message authorizes this deletion target' }
}

interface Harness {
  readonly canary: string
  readonly dshHome: string
  readonly workspace: string
  readonly scratch: string
  readonly classifierCalls: readonly ClassifierInput[]
  readonly approvalRequests: readonly unknown[]
  readonly commands: readonly string[]
  readonly results: readonly ToolExecutionResult[]
  autoGuidance(userMessages: readonly string[]): Promise<string | undefined>
  modelTools(userMessages: readonly string[]): Promise<readonly ToolSchema[]>
  run(id: string, command: string, userMessages: readonly string[], sandboxArguments?: Record<string, unknown>): Promise<PreToolDecision>
  runTool(name: ToolExecutionInput['name'], id: string, command: string, userMessages: readonly string[], sandboxArguments?: Record<string, unknown>): Promise<PreToolDecision>
  dispose(): Promise<void>
}

async function createHarness(options: { failClassifier?: boolean } = {}): Promise<Harness> {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-auto-mode-workspace-'))
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-auto-mode-scratch-'))
  const dshHome = join(await mkdtemp(join(tmpdir(), 'dsh-auto-mode-home-')), '.dsh')
  await mkdir(dshHome, { recursive: true })
  const canary = join(scratch, 'dsh-auto-protected-canary')
  await mkdir(canary, { recursive: true })
  await writeFile(join(canary, 'keep.txt'), 'canary\n')

  const classifierCalls: ClassifierInput[] = []
  const approvalRequests: unknown[] = []
  const commands: string[] = []
  const results: ToolExecutionResult[] = []
  const context = new Context()
  provideTestPermissionPresets(context)
  context.provide('agents', { get: () => undefined })
  context.provide('llm', {
    stream(generate: GenerateOptions): AsyncIterable<StreamChunk> {
      const block = generate.messages[0]?.content[0]
      const input = JSON.parse(block?.type === 'text' ? block.text : '{}') as ClassifierInput
      classifierCalls.push(input)
      if (options.failClassifier === true) throw new Error('classifier route is unavailable')
      const text = JSON.stringify(classifierDecision(input))
      return (async function* () {
        yield { type: 'text-delta', index: 0, text } as const
        yield { type: 'finish', reason: { kind: 'stop' } } as const
      })()
    },
  })
  await context.plugin(SystemPrompt).await()
  await context.plugin(ToolRuntime).await()
  await context.plugin(AutoMode, { modelReview: false,
    workspaceRoot: workspace,
    dshHome,
    tempRoots: [scratch],
    classifierTimeoutMs: 1_000,
  }).await()

  context.on('approval/request', (request, next) => {
    approvalRequests.push(request)
    return next()
  })
  context.on('tools/result', (_exec, result) => {
    results.push(result)
  })

  let decision: PreToolDecision | undefined
  context.on('tools/pre-execute', async (_exec, next) => {
    decision = await next()
    return decision
  }, { prepend: true })

  context.tools.register(defineTool({
    name: 'bash',
    description: 'Records the command instead of running a shell.',
    parameters: {
      command: { type: 'string', required: true },
      sandbox_permissions: { type: 'string' },
      justification: { type: 'string' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { exitCode: { type: 'number', required: true } } },
      render: () => [{ type: 'text', text: 'ok' }],
    },
    async execute(args: { command: string; sandbox_permissions?: string; justification?: string }) {
      commands.push(args.command)
      return { exitCode: 0 }
    },
  }))
  context.tools.register(defineTool({
    name: 'pwsh',
    description: 'Unrelated recovery-schema probe.',
    parameters: {
      command: { type: 'string', required: true },
      sandbox_permissions: { type: 'string', required: true },
      justification: { type: 'string', required: true },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { exitCode: { type: 'number', required: true } } },
      render: () => [{ type: 'text', text: 'ok' }],
    },
    async execute() {
      return { exitCode: 0 }
    },
  }))

  const agents = new Map<string, NonNullable<ToolExecutionInput['agent']>>()
  const agentFor = (userMessages: readonly string[]) => {
    const key = JSON.stringify(userMessages)
    const existing = agents.get(key)
    if (existing !== undefined) return existing
    const agent = {
      options: { provider: 'mock-provider', model: 'mock-model' },
      session: {
        header: { id: 'session-auto', cwd: workspace },
        requestHeader: () => ({ config: { provider: 'mock-provider', model: 'mock-model' } }),
        events: [
          { type: 'permission/preset', data: { preset: 'auto' } },
          ...userMessages.map((text, index) => ({
            type: 'user/message',
            data: {
              id: `message-${index}`,
              role: 'user',
              content: [{ type: 'text', text }],
              source: { kind: 'user' },
            },
          })),
        ],
      },
    } as unknown as NonNullable<ToolExecutionInput['agent']>
    agents.set(key, agent)
    return agent
  }

  const runTool = async (
    name: ToolExecutionInput['name'],
    id: string,
    command: string,
    userMessages: readonly string[],
    sandboxArguments?: Record<string, unknown>,
  ): Promise<PreToolDecision> => {
    decision = undefined
    await context.tools.execute({
      callId: ToolCallId(id),
      name,
      arguments: { command, ...sandboxArguments },
      agent: agentFor(userMessages),
      signal: new AbortController().signal,
    })
    return decision as PreToolDecision
  }

  return {
    canary,
    dshHome,
    workspace,
    scratch,
    classifierCalls,
    approvalRequests,
    commands,
    results,
    async autoGuidance(userMessages) {
      return (await context.systemPrompt.assemble({ agent: agentFor(userMessages) })).contexts
        .find(item => item.name === 'auto-mode:policy')?.text
    },
    async modelTools(userMessages) {
      return (await context.systemPrompt.assemble({ agent: agentFor(userMessages) })).tools
    },
    runTool,
    async run(id, command, userMessages, sandboxArguments) {
      return runTool('bash', id, command, userMessages, sandboxArguments)
    },
    async dispose() {
      await context.fiber.dispose()
      for (const path of [workspace, scratch, join(dshHome, '..')]) {
        await rm(path, { recursive: true, force: true })
      }
    },
  }
}

let harness: Harness | undefined

beforeEach(async () => {
  harness = await createHarness()
})

afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})


describe('sandbox fields cannot recover blocked code execution', () => {
  it.each([{}, { sandbox_permissions: 'workspace-write' }, { sandbox_permissions: 'danger-full-access', justification: 'approved' }, { sandbox_permissions: null }, { sandbox_permissions: '' }])('never executes a shell retry with %j', async fields => {
    const active = harness as Harness
    expect(await active.run('retry', 'printf harmless', ['approved'], fields)).toMatchObject({ kind: 'deny' })
    expect(active.classifierCalls).toEqual([])
    expect(active.approvalRequests).toEqual([])
    expect(active.commands).toEqual([])
  })
  it('projects preservation guidance without granting a recovery bypass', async () => {
    const guidance = await (harness as Harness).autoGuidance(['continue'])
    expect(guidance).toContain('independently isolated execution broker')
    expect(guidance).toContain('No cleanup or deletion is automatically authorized')
  })
})
