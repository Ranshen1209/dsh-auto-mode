/** Deterministic test-only model. This is never a real provider/API acceptance test. */
import { LlmAdapter, LlmRuntime, ToolCallId } from '@deepseek-ai/dsh-llm'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { PermissionPresetService } from '@deepseek-ai/dsh-permission-presets'
import { Session } from '@deepseek-ai/dsh-session'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

const tracePath = process.env.AUTO_FIXTURE_TRACE
const root = process.env.AUTO_FIXTURE_EFFECTS
if (!tracePath || !root) throw Error('Auto Mode product fixture requires its isolated runner')
const trace = value => appendFileSync(tracePath, JSON.stringify({ ...value, time: Date.now() }) + '\n')
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"
const write = (file, value) => `printf '%s\\n' ${quote(value)} > ${quote(join(root, file))}`
const bash = (label, file, extra = {}) => ({ label, name: 'bash', args: { command: write(file, label), description: `Auto Mode fixture ${label}`, ...extra } })
const widen = (label, file, justification) => bash(label, file, { sandbox_permissions: 'danger-full-access', justification })
const parentPlan = [
  { label: 'read', name: 'read', args: { file_path: join(root, 'existing.txt') } },
  ...['model-denied', 'model-error', 'model-invalid'].map(label => ({ label, name: 'write', args: { file_path: join(root, label + '.txt'), content: 'must not exist' } })),
  { label: 'edit-approved', name: 'edit', args: { file_path: join(root, 'existing.txt'), old_string: 'valuable', new_string: 'approved' } },
  { label: 'write-approved', name: 'write', args: { file_path: join(root, 'approved.txt'), content: 'approved new file' } },
  { label: 'write-rejected', name: 'write', args: { file_path: join(root, 'denied.txt'), content: 'must not exist' } },
  ...['ordinary', 'widening', 'cleanup'].map(label => ({ label, name: process.platform === 'win32' ? 'pwsh' : 'bash', args: {
    command: label === 'cleanup' ? (process.platform === 'win32' ? `Remove-Item -LiteralPath '${process.env.AUTO_FIXTURE_PROTECTED.replaceAll("'", "''")}'` : `rm '${process.env.AUTO_FIXTURE_PROTECTED}'`) : 'echo synthetic',
    description: 'This command must never execute',
    ...(label === 'widening' ? { sandbox_permissions: 'danger-full-access', justification: 'user authorized cleanup' } : {}),
  } })),
  { label: 'delegation', name: 'subagent', args: { description: 'Must be blocked', prompt: 'No execution is permitted', run_in_background: false } },
]
const childPlan = []
const calls = new Map()
const steps = new Map()
let sequence = 0
const model = { provider: 'auto-mode-fixture', id: 'deterministic', name: 'Auto Mode deterministic fixture (no API)', context: { contextWindow: 262144 }, defaultMaxTokens: 8192, reasoning: { efforts: [{ id: 'low', name: 'low' }], defaultEffort: 'low' } }
function* textChunks(text) {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}
function* toolChunks(step) {
  const id = ToolCallId(`auto-fixture-${++sequence}-${step.label}`)
  calls.set(String(id), step.label)
  const args = JSON.stringify(step.args)
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id, name: step.name, argumentsDelta: args }
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: step.name, arguments: args } }
  yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}
class FixtureAdapter extends LlmAdapter {
  async listModels() { return [model] }
  async resolveModel(provider, id) { return { ...model, provider, id } }
  async *stream(options) {
    options.signal?.throwIfAborted()
    if (options.system?.includes('PRESERVATION_REVIEW_POLICY')) {
      const text = options.messages.flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text)).join('\n')
      const action = JSON.parse(text.split('PENDING_ACTION\n\n')[1])
      const mode = action.arguments?.file_path?.split(/[\\/]/).at(-1)
      const decision = mode === 'model-denied.txt' ? 'deny' : 'allow'
      trace({ event: 'model-review', action: action.name, file: mode, decision, provider: options.provider, model: options.model })
      if (mode === 'model-error.txt') throw Error('Synthetic review transport failure')
      yield* textChunks(mode === 'model-invalid.txt' ? '{"decision":"allow"}' : JSON.stringify({ risk: action.name === 'read' ? 'low' : 'medium', decision }))
      return
    }
    if (options.purpose) { yield* textChunks('Auto Mode fixture'); return }
    const directText = options.messages.filter(message => message.role === 'user').flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text)).join('\n')
    const child = directText.includes('AUTO_FIXTURE_CHILD:')
    const key = `${String(options.sessionId)}:${child}`
    const index = steps.get(key) ?? 0
    const plan = child ? childPlan : parentPlan
    const step = plan[index]
    const bashSchema = options.tools?.find(tool => tool.name === 'bash')?.parameters
    trace({ event: 'model-request', sessionId: options.sessionId, child, step: step?.label ?? 'finish', cwdGuidance: options.system?.includes('/tmp'), autoGuidance: (String(options.system) + directText).includes('<auto_mode_policy>'), toolNames: (options.tools ?? []).map(tool => tool.name), bashHasSandboxField: Object.prototype.hasOwnProperty.call(bashSchema?.properties ?? {}, 'sandbox_permissions') })
    steps.set(key, index + 1)
    if (!step) { yield* textChunks(child ? 'AUTO_MODE_CHILD_PRODUCT_OK' : 'AUTO_MODE_PRODUCT_FIXTURE_OK'); return }
    if (!options.tools?.some(tool => tool.name === step.name)) throw Error(`Fixture requires real product tool ${step.name}`)
    yield* toolChunks(step)
  }
}
export const name = 'auto-mode-product-fixture'
export const inject = ['llm', 'tools', 'permissionPresets', 'agents']
export function apply(ctx) {
  ctx.llm.registerAdapter(['auto-mode-fixture'], new FixtureAdapter())
  ctx.on('approval/request', async (request, next) => {
    const label = calls.get(String(request.callId))
    if (!label) return next()
    const outcome = label.endsWith('-approved') ? 'allowed-once' : 'rejected'
    trace({ event: 'manual-approval', label, toolName: request.toolName, reason: request.reason, outcome })
    return outcome
  })
  ctx.on('tools/result', (exec, result) => {
    const label = calls.get(String(exec.callId))
    if (!label) return
    trace({ event: 'tool-result', label, name: exec.name, isError: result.isError, error: result.isError ? result.error?.message : undefined, value: !result.isError && exec.name === 'bash' ? result.value : undefined, sessionId: exec.agent?.session.id, cwd: exec.agent?.session.header.cwd, child: exec.agent?.session.header.origin === 'subagent', sessionIdentityMatches: exec.agent?.session instanceof Session, preset: exec.agent ? ctx.permissionPresets.current(exec.agent.session) : undefined })
  })
  ctx.on('session/event', (session, event) => {
    if (event.type === 'approval/asked' || event.type === 'approval/decided') trace({ event: event.type, sessionId: session.id, data: event.data })
  })
  trace({ event: 'fixture-activated', servicesMatchResolvedClasses: { llm: ctx.llm instanceof LlmRuntime, tools: ctx.tools instanceof ToolRuntime, permissionPresets: ctx.permissionPresets instanceof PermissionPresetService }, provider: 'auto-mode-fixture', realApi: false, process: { pid: process.pid, cwd: process.cwd(), node: process.version } })
}
