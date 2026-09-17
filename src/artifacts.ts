import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { PolicyRoots } from './paths.js'

/** @deprecated Inert compatibility shim. Artifact origin can never authorize deletion. */
export class ArtifactRegistry {
  has(_owner: object | undefined, _path: string, _roots: PolicyRoots): boolean { return false }
  hasTree(_owner: object | undefined, _path: string, _roots: PolicyRoots): boolean { return false }
  plan(_exec: ToolExecution, _paths: readonly string[], _roots: PolicyRoots): void {}
  discoverShellCreates(_exec: ToolExecution, _roots: PolicyRoots): void {}
  settle(_exec: ToolExecution, _result: ToolExecutionResult, _roots: PolicyRoots): void {}
}
