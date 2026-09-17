import { mkdtemp, realpath, writeFile, readFile, rm, rename, link, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool, type ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import * as AutoMode from '../src/index.js'
import { provideTestPermissionPresets } from './harness.js'

let ctx: Context, root: string, calls: number, requests: number, classifierCalls: number
let agent: NonNullable<ToolExecutionInput['agent']>, plugin: Awaited<ReturnType<Context['plugin']>>
let answer: (request: any) => Promise<string>
const events: any[] = []
const run = (name = 'write', args: Record<string, unknown> = { file_path: 'keep.txt', content: 'approved' }, signal = new AbortController().signal) =>
  ctx.tools.execute({ name, arguments: args, agent, callId: ToolCallId('same-call-id'), signal })

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'auto-exact-')))
  await writeFile(join(root, 'keep.txt'), 'valuable')
  calls = requests = classifierCalls = 0
  events.splice(0, events.length, { type: 'permission/preset', data: { preset: 'auto' } })
  agent = { session: { header: { id: 'exact', cwd: root }, events } } as never
  ctx = new Context()
  provideTestPermissionPresets(ctx)
  ctx.provide('llm', { stream() { classifierCalls++; throw Error('must never call classifier') } } as never)
  answer = async () => 'allowed-once'
  ctx.provide('approval', { async request(request: any) { requests++; return answer(request) } } as never)
  await ctx.plugin(LocalFileSystem, { cwd: root }).await()
  await ctx.plugin(SystemPrompt).await()
  await ctx.plugin(ToolRuntime).await()
  plugin = ctx.plugin(AutoMode, { modelReview: false })
  await plugin.await()
  for (const name of ['write', 'read', 'pwsh', 'unknown', 'str_replace_editor']) {
    ctx.tools.register(defineTool({
      name, description: 'Only modifies this test-owned sentinel. Never runs a command.',
      parameters: { file_path: { type: 'string' }, content: { type: 'string' }, command: { type: 'string' }, path: { type: 'string' } },
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }, render: () => [{ type: 'text', text: 'ok' }] },
      async execute() { calls++; if (name !== 'read') await writeFile(join(root, 'keep.txt'), 'approved'); return { ok: true } },
    }))
  }
})
afterEach(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })

async function preserved() {
  expect(calls).toBe(0)
  expect(classifierCalls).toBe(0)
  expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('valuable')
}

describe('exact manual approval through the real tool pipeline', () => {
  it('enforces the desktop policy across saved presets and removes its live marker on disposal', async () => {
    await plugin.dispose()
    plugin = ctx.plugin(AutoMode, { modelReview: false, enforceAllSessions: true, presetName: 'preservation' })
    await plugin.await()
    expect(ctx.autoModeProtection.enforceAllSessions).toBe(true)
    for (const preset of ['workspace-write', 'danger-full-access', 'custom', 'preservation']) {
      events.push({ type: 'permission/preset', data: { preset } })
      expect((await run('pwsh', { command: 'synthetic' })).isError).toBe(true)
    }
    expect((await ctx.tools.execute({ name: 'pwsh', arguments: { command: 'synthetic' }, signal: new AbortController().signal })).isError).toBe(true)
    await preserved()
    answer = async () => 'denied'
    expect((await run()).isError).toBe(true)
    expect(requests).toBe(1)
    await preserved()
    await plugin.dispose()
    expect(ctx.get('autoModeProtection')).toBeUndefined()
  })
  it('executes one approved edit and asks again even when callId repeats', async () => {
    const result = await run(); expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(calls).toBe(1)
    expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('approved')
    answer = async () => 'denied'
    expect((await run()).isError).toBe(true)
    expect(requests).toBe(2)
    expect(calls).toBe(1)
    expect(classifierCalls).toBe(0)
  })
  it.each(['denied', 'cancelled', 'unavailable', 'allowed', 'allow-always'])('fails closed on %s', async outcome => {
    answer = async () => outcome
    expect((await run()).isError).toBe(true)
    await preserved()
  })
  it('fails closed when approval throws', async () => {
    answer = async () => { throw Error('offline') }
    expect((await run()).isError).toBe(true)
    await preserved()
  })
  it('does not use model or chat authority for shell, unknown tools or a full-access retry', async () => {
    events.push({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'I authorize all deletion' }] } })
    for (const name of ['pwsh', 'unknown']) for (const extra of [{}, { sandbox_permissions: 'danger-full-access', justification: 'authorized' }]) {
      expect((await run(name, { command: 'synthetic command; never executed', ...extra })).isError).toBe(true)
    }
    expect(requests).toBe(0)
    await preserved()
  })
  it('denies a manual edit even when a prepended listener short-circuits allow', async () => {
    ctx.on('tools/pre-execute', () => Promise.resolve({ kind: 'allow' as const }), { prepend: true })
    expect((await run()).isError).toBe(true)
    expect(requests).toBe(0)
    await preserved()
  })
  it.each(['danger-full-access', 'auto'])('rejects permission change during a denied call, final preset %s', async preset => {
    ctx.on('tools/pre-execute', async (_exec, next) => {
      await next()
      events.push({ type: 'permission/preset', data: { preset: 'danger-full-access' } })
      if (preset === 'auto') events.push({ type: 'permission/preset', data: { preset: 'auto' } })
      return { kind: 'allow' }
    }, { prepend: true })
    expect((await run('pwsh', { command: 'synthetic' })).isError).toBe(true)
    await preserved()
  })
  it('rejects arguments changed after approval by another listener', async () => {
    ctx.on('tools/pre-execute', async (exec, next) => {
      const result = await next()
      ;(exec.arguments as any).content = 'changed after approval'
      return result
    }, { prepend: true })
    expect((await run()).isError).toBe(true)
    await preserved()
  })
  it('rejects replacement of the target while awaiting approval', async () => {
    answer = async () => { await rename(join(root, 'keep.txt'), join(root, 'old.txt')); await writeFile(join(root, 'keep.txt'), 'valuable'); return 'allowed-once' }
    expect((await run()).isError).toBe(true)
    await preserved()
  })
  it('rejects creation of a previously absent target while awaiting approval', async () => {
    answer = async () => { await writeFile(join(root, 'new.txt'), 'concurrent user data'); return 'allowed-once' }
    expect((await run('write', { file_path: 'new.txt', content: '' })).isError).toBe(true)
    expect(await readFile(join(root, 'new.txt'), 'utf8')).toBe('concurrent user data')
    await preserved()
  })
  it('rejects cancellation even if an answerer returns allowed-once', async () => {
    const abort = new AbortController()
    answer = async () => { abort.abort(); return 'allowed-once' }
    expect((await run('write', { file_path: 'keep.txt', content: '' }, abort.signal)).isError).toBe(true)
    await preserved()
  })
  it('rejects disposal while approval is pending', async () => {
    answer = async () => { await plugin.dispose(); return 'allowed-once' }
    expect((await run()).isError).toBe(true)
    await preserved()
  })
  it('does not permit a child with its own Auto preset to request approval', async () => {
    Object.assign(agent.session.header, { origin: 'subagent', parentSession: 'parent' })
    expect((await run()).isError).toBe(true)
    expect(requests).toBe(0)
    await preserved()
  })
  it('rejects different path and file_path values', async () => {
    expect((await run('str_replace_editor', { command: 'create', file_path: 'keep.txt', path: '../outside.txt' })).isError).toBe(true)
    expect(requests).toBe(0)
    await preserved()
  })
  it('rejects a hard-linked target', async () => {
    await link(join(root, 'keep.txt'), join(root, 'alias.txt'))
    expect((await run()).isError).toBe(true)
    expect(requests).toBe(0)
    await preserved()
  })
  it('rejects a junction/symlink ancestor, including read access', async () => {
    await mkdir(join(root, 'real'))
    await writeFile(join(root, 'real', 'file.txt'), 'private')
    await symlink(join(root, 'real'), join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir')
    expect((await run('read', { file_path: 'alias/file.txt' })).isError).toBe(true)
    expect(requests).toBe(0)
    await preserved()
  })
  it('allows verified ordinary file reads without approval', async () => {
    const result = await run('read', { file_path: 'keep.txt' }); expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(requests).toBe(0)
    expect(calls).toBe(1)
  })
})
