import { mkdtemp, realpath, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import ToolRuntime, { type ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import * as AutoMode from '../src/index.js'
import { provideTestPermissionPresets } from './harness.js'

let ctx: Context, root: string, agent: NonNullable<ToolExecutionInput['agent']>
let decide: () => Promise<'allowed-once' | 'rejected'>
let events: any[]
const run = (name: string, args: object) => ctx.tools.execute({ name, arguments: args, agent, callId: ToolCallId('file-call'), signal: new AbortController().signal })
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'auto-commit-')))
  await writeFile(join(root, 'keep.txt'), 'valuable')
  events = [{ type: 'turn/start' }, { type: 'permission/preset', data: { preset: 'auto' } }]
  const session = {
    id: 'file-commit', header: { id: 'file-commit', cwd: root }, events,
    get seq() { return events.length },
    eventAt(index: number) { return events[index] && { ...events[index], seq: index } },
    snapshotEvents(from = 0, to = events.length) { return events.slice(from, to) },
    append(type: string, data: unknown) { const event = { type, data }; events.push(event); return event },
  }
  agent = { session } as never
  ctx = new Context()
  provideTestPermissionPresets(ctx)
  await ctx.plugin(SessionProjectionRegistry).await()
  await ctx.plugin(SystemPrompt).await()
  await ctx.plugin(ToolRuntime).await()
  await ctx.plugin(LocalFileSystem, { cwd: root }).await()
  await ctx.plugin(ApprovalService, { policy: 'ask' }).await()
  await ctx.plugin(ToolFs, {}).await()
  await ctx.plugin(AutoMode, { modelReview: false }).await()
  decide = async () => 'allowed-once'
  ctx.on('approval/request', () => decide())
})
afterEach(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })

describe('official approval, file tools and conditional filesystem commit', () => {
  it('rejects a different filesystem world even when its paths have the same spelling', async () => {
    ctx.fs.processPathFromHostPath = () => undefined
    expect((await run('read', { file_path: 'keep.txt' })).isError).toBe(true)
    expect((await run('write', { file_path: 'keep.txt', content: '' })).isError).toBe(true)
    expect(events.filter(e => e.type === 'approval/asked')).toHaveLength(0)
    expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('valuable')
  })
  it('approves a single write with durable approval events and real file effects', async () => {
    const result = await run('write', { file_path: 'keep.txt', content: 'approved' })
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('approved')
    expect(events.filter(e => e.type === 'approval/asked')).toHaveLength(1)
    expect(events.find(e => e.type === 'approval/decided')?.data.outcome).toBe('allowed-once')
  })
  it('creates only the approved absent file', async () => {
    const result = await run('write', { file_path: 'new.txt', content: 'new' })
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(await readFile(join(root, 'new.txt'), 'utf8')).toBe('new')
    expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('valuable')
  })
  it('preserves the file on an actual rejected approval', async () => {
    decide = async () => 'rejected'
    expect((await run('write', { file_path: 'keep.txt', content: '' })).isError).toBe(true)
    expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('valuable')
  })
  it('detects changes after dispatch, immediately before the filesystem mutation', async () => {
    ctx.on('tools/execute', async (_exec, next) => { await writeFile(join(root, 'keep.txt'), 'concurrent user data'); return next() })
    expect((await run('write', { file_path: 'keep.txt', content: '' })).isError).toBe(true)
    expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('concurrent user data')
  })
  it.each([true, false])('does not repeat an edit with an around wrapper prepended=%s', async prepend => {
    ctx.on('tools/execute', async (_exec, next) => { await next(); return next() }, { prepend })
    const result = await run('edit', { file_path: 'keep.txt', old_string: 'valuable', new_string: 'valuable!' })
    expect(result.isError).toBe(true)
    expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('valuable!')
  })
  it('enforces backend version condition even after another intent listener waits', async () => {
    ctx.on('fs/write-intent', async (_target, _actor, next) => {
      const intent = await next()
      await writeFile(join(root, 'keep.txt'), 'racing data')
      return intent
    }, { prepend: true })
    const result = await run('write', { file_path: 'keep.txt', content: '' })
    expect(result.isError).toBe(true)
    expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('racing data')
  })
})
