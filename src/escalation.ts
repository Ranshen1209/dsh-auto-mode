import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { SandboxEscalationRequest } from './policy.js'

/** @deprecated Inert compatibility shim. Automatic sandbox grants have been removed. */
export class AutoApprovalGrants {
  plan(_exec: Readonly<ToolExecution>, _request: SandboxEscalationRequest): void {}
  decide(_request: ApprovalRequest): undefined { return undefined }
  settle(_exec: Readonly<ToolExecution>): void {}
}
