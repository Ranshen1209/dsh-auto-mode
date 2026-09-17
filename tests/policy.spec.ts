import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { resolveRoots, type PolicyRoots } from '../src/paths.js'
import { assessTool, hardDenyReason } from '../src/policy.js'
import { ambiguousPathReason } from '../src/file-boundary.js'
let workspace: string, roots: PolicyRoots
const assess = (name: string, args: unknown = {}) => assessTool({ name, arguments: args } as ToolExecution, roots)
beforeEach(async () => {
  workspace = await realpath(await mkdtemp(join(tmpdir(), 'auto-policy-')))
  roots = resolveRoots(workspace, { dshHome: join(workspace, '.dsh') })
  await writeFile(join(workspace, 'source.txt'), 'valuable')
})
afterEach(async () => { await rm(workspace, { recursive: true, force: true }) })
describe('deterministic preservation policy', () => {
  it('allows exact reads and requires manual authority for writes', () => {
    expect(assess('read', { file_path: 'source.txt' })).toMatchObject({ decision: 'allow', classifierEligible: false })
    expect(assess('write', { file_path: 'source.txt', content: '' })).toMatchObject({ decision: 'ask', classifierEligible: false })
    expect(assess('edit', { file_path: 'source.txt' })).toMatchObject({ decision: 'ask', classifierEligible: false })
    expect(assess('str_replace_editor', { path: join(workspace, 'source.txt'), command: 'str_replace' })).toMatchObject({ decision: 'ask', classifierEligible: false })
  })
  it('requires manual approval for credential reads and denies mutations', async () => {
    for (const file of ['.env', '.npmrc', '.netrc', '.pypirc']) {
      await writeFile(join(workspace, file), 'synthetic')
      expect(assess('read', { file_path: file }).decision).toBe('ask')
      expect(assess('write', { file_path: file }).decision).toBe('deny')
    }
  })
  it('blocks protected metadata at every depth and workspace root/ancestor writes', async () => {
    await mkdir(join(workspace, 'nested', '.git'), { recursive: true })
    for (const file of ['nested/.git/config', 'AGENTS.md', '.mcp.json', workspace, '..', '../outside.txt', '.dsh/config.json']) {
      expect(assess('write', { file_path: file }).decision, file).toBe('deny')
    }
  })
  it.each(['apply_patch', 'mcp_custom', 'plugin_render_diagram', 'plugin_read_metrics', 'plugin_create_widget',
    'plugin_delete_record', 'cloud_deploy', 'repo_push', 'account_grant_role', 'subagent', 'workflow', 'ralph',
    'send_message', 'interrupt_agent', 'terminal_open', 'terminal_send', 'terminal_signal', 'cordis_inspect_query',
    'agent_teams_create', 'agent_teams_delete', 'agent_teams_destroy_workspace', 'exit_plan_mode', 'skill', 'grep', 'glob'])('blocks opaque capability %s', name => {
    expect(assess(name)).toMatchObject({ decision: 'deny', classifierEligible: false })
  })
  it.each(['todo_write', 'ask_user_question', 'get_goal', 'create_goal', 'update_goal', 'report', 'job_list', 'job_kill', 'schedule_list', 'session_search'])('allows audited session control %s', name => {
    expect(assess(name)).toMatchObject({ decision: 'allow', classifierEligible: false })
  })
  it.each(['C:relative', 'C:/work/file:stream', 'C:/work/file.', 'C:/work/file ', 'C:/PROGRA~1/file',
    'C:/work/NUL', 'C:/work/CON.txt', '//server/share/file', '//?/C:/work/file', 'C:/work/../other', 'C:/work/*'])('rejects ambiguous Windows syntax %s', path => {
    expect(ambiguousPathReason(path, true)).toBeDefined()
  })
  it('does not accept alternate file fields or sandbox widening', () => {
    expect(assess('write', { path: 'source.txt' }).decision).toBe('deny')
    expect(assess('str_replace_editor', { path: 'source.txt', file_path: '../outside', command: 'create' }).decision).toBe('deny')
    for (const mode of [null, '', 'workspace-write', 'danger-full-access']) {
      expect(assess('write', { file_path: 'source.txt', sandbox_permissions: mode }).decision).toBe('deny')
    }
  })
  it('blocks encoded outbound credential URLs', () => {
    expect(hardDenyReason({ name: 'web_fetch', arguments: { url: 'https://example.invalid/?access%5Ftoken=abcdefgh12345678' } } as ToolExecution, roots)).toMatch(/credential/)
  })
})
