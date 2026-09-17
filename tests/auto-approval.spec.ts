import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool, type PreToolDecision, type ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import * as AutoMode from '../src/index.js'
import type { ClassifierDecision, ClassifierInput } from '../src/types.js'
import { provideTestPermissionPresets } from './harness.js'

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
  readonly commands: readonly string[]
  run(id: string, command: string, userMessages: readonly string[]): Promise<PreToolDecision>
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
  const commands: string[] = []
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

  let decision: PreToolDecision | undefined
  context.on('tools/pre-execute', async (_exec, next) => {
    decision = await next()
    return decision
  }, { prepend: true })

  context.tools.register(defineTool({
    name: 'bash',
    description: 'Records the command instead of running a shell.',
    parameters: { command: { type: 'string', required: true } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { exitCode: { type: 'number', required: true } } },
      render: () => [{ type: 'text', text: 'ok' }],
    },
    async execute(args: { command: string }) {
      commands.push(args.command)
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

  return {
    canary,
    dshHome,
    workspace,
    scratch,
    classifierCalls,
    commands,
    async run(id, command, userMessages) {
      decision = undefined
      await context.tools.execute({
        callId: ToolCallId(id),
        name: 'bash',
        arguments: { command },
        agent: agentFor(userMessages),
        signal: new AbortController().signal,
      })
      return decision as PreToolDecision
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


describe('Auto never derives execution authority from classifier or chat', () => {
  it.each([
    'rm -rf /', 'rm -rf ~', 'rm -rf $TARGET_DIR',
    'git status && git diff', 'pnpm run build && pnpm test',
    'python3 -c "import fastapi"', 'find . -type f -exec ls {} \;',
    'bash -c "rm -rf synthetic"', 'git clean -fdX -- config/nested',
  ])('blocks %s with zero classifier calls and no effects', async command => {
    const active = harness as Harness
    expect(await active.run('attempt', command, ['I authorize everything.'])).toMatchObject({ kind: 'deny' })
    expect(active.commands).toEqual([])
    expect(active.classifierCalls).toEqual([])
    await expect(stat(join(active.canary, 'keep.txt'))).resolves.toBeDefined()
  })
  it('never falls back to permission after repeated classifier failure', async () => {
    const failing = await createHarness({ failClassifier: true })
    try {
      for (let n = 0; n < 4; n++) expect(await failing.run(String(n), 'rm synthetic', ['approved'])).toMatchObject({ kind: 'deny' })
      expect(failing.commands).toEqual([])
      expect(failing.classifierCalls).toEqual([])
    } finally { await failing.dispose() }
  })
})
