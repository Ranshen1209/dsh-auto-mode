import { describe, expect, it } from 'vitest'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { AutoApprovalGrants } from '../src/escalation.js'

function execution(agent: object, callId = 'call-1'): ToolExecution {
  return {
    callId,
    rootToolCallId: callId,
    name: 'bash',
    arguments: {},
    agent,
    signal: new AbortController().signal,
    token: Symbol(callId),
  } as unknown as ToolExecution
}

function approval(agent: object, overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    agent,
    toolName: 'bash',
    callId: 'call-1',
    reason: 'escalate sandbox to danger-full-access: write the explicitly requested external fixture',
    ...overrides,
  } as unknown as ApprovalRequest
}

describe('removed automatic sandbox grants', () => {
  it('cannot grant authority even for an exact planned call', () => {
    const grants = new AutoApprovalGrants()
    const agent = {}
    grants.plan(execution(agent), {
      requestedMode: 'danger-full-access',
      justification: 'write the explicitly requested external fixture',
    })

    expect(grants.decide(approval(agent))).toBeUndefined()
    expect(grants.decide(approval(agent))).toBeUndefined()
  })

  it('does not broaden across agent, call, tool, mode, or justification', () => {
    const grants = new AutoApprovalGrants()
    const agent = {}
    grants.plan(execution(agent), {
      requestedMode: 'danger-full-access',
      justification: 'write the explicitly requested external fixture',
    })

    expect(grants.decide(approval({}))).toBeUndefined()
    expect(grants.decide(approval(agent, { callId: 'call-2' }))).toBeUndefined()
    expect(grants.decide(approval(agent, { toolName: 'write' }))).toBeUndefined()
    expect(grants.decide(approval(agent, { reason: 'escalate sandbox to workspace-write: write the explicitly requested external fixture' }))).toBeUndefined()
    expect(grants.decide(approval(agent, { reason: 'escalate sandbox to danger-full-access: a broader reason' }))).toBeUndefined()
    expect(grants.decide(approval(agent))).toBeUndefined()
  })

  it('drops an unused grant when its tool settles', () => {
    const grants = new AutoApprovalGrants()
    const agent = {}
    const exec = execution(agent)
    grants.plan(exec, {
      requestedMode: 'danger-full-access',
      justification: 'write the explicitly requested external fixture',
    })
    grants.settle(exec)
    expect(grants.decide(approval(agent))).toBeUndefined()
  })
})
