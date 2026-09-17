import type { ArtifactRegistry } from './artifacts.js'
import type { PolicyRoots } from './paths.js'
import type { Assessment } from './types.js'

export type ShellKind = 'bash' | 'pwsh'

export interface ParsedCommand {
  readonly tokens: readonly string[]
}

/** One command-line word with the static properties this policy depends on. */
export interface CommandWord {
  /** Quote-removed text; an unresolved expansion keeps its written form. */
  readonly text: string
  /** Whether the word expands a variable that cannot be resolved statically. */
  readonly dynamic: boolean
  /** Whether the word carries an unquoted `*` or `?` metacharacter. */
  readonly glob: boolean
  /** Whether the word was written with quoting or escaping. */
  readonly quoted: boolean
  /** Whether the whole word is quoted, without unquoted command-name fragments. */
  readonly fullyQuoted?: boolean
}

/** One statically separated command inside a Bash or PowerShell command line. */
export interface ShellSegment {
  readonly words: readonly CommandWord[]
  /** File targets of `>`/`>>`-style redirection; descriptor duplication has none. */
  readonly writeTargets: readonly CommandWord[]
  /** File sources of `<`-style redirection. */
  readonly readTargets: readonly CommandWord[]
}

/** Static split of a command line, or the reason it cannot be read at all. */
export type ShellDecomposition =
  | { readonly kind: 'segments'; readonly segments: readonly ShellSegment[] }
  | { readonly kind: 'opaque'; readonly reason: string }

function opaque(reason: string): ShellDecomposition {
  return { kind: 'opaque', reason }
}

/** Sticky patterns matched in place, so the lexer never copies the remaining input. */
const DESCRIPTOR_DUPLICATION = /[<>]&\s*(?:[0-9]+|-)/y
const REDIRECT_OPERATOR = /(?:>>|>\||>&|<&|>|<)/y
const MERGED_REDIRECT = /&>>?/y
const CMD_VARIABLE = /%[A-Za-z_][A-Za-z0-9_()]*%/y
const BASH_EXPANSION = /\$[A-Za-z_][A-Za-z0-9_]*/y
const PWSH_EXPANSION = /\$(?:env:)?[A-Za-z_][A-Za-z0-9_]*/y

function matchAt(pattern: RegExp, input: string, index: number): string | undefined {
  pattern.lastIndex = index
  return pattern.exec(input)?.[0]
}

/**
 * Read one `$` expansion and return its written form, or `undefined` when the
 * construct executes a nested command instead of naming a variable.
 */
function readExpansion(input: string, index: number, shell: ShellKind): string | undefined {
  const next = input[index + 1]
  if (next === '(' || next === "'" || next === '"') return undefined
  if (next === '{') {
    const end = input.indexOf('}', index + 2)
    if (end < 0) return undefined
    const body = input.slice(index + 2, end)
    if (/[($`]/.test(body)) return undefined
    return input.slice(index, end + 1)
  }
  return matchAt(shell === 'pwsh' ? PWSH_EXPANSION : BASH_EXPANSION, input, index) ?? '$'
}

/**
 * Split one command line into segments, redirections, and word metadata.
 *
 * Operators separate segments so that every command in a compound line is
 * assessed on its own. Constructs whose effect cannot be read statically —
 * command substitution, here-documents, grouping, unbalanced quotes — return
 * `opaque`. The policy can still run ordinary opaque syntax inside the OS
 * sandbox while separately recognizing sensitive or destructive effects.
 */
export function decomposeCommandLine(source: string, shell: ShellKind): ShellDecomposition {
  const input = source
  const segments: ShellSegment[] = []
  let words: CommandWord[] = []
  let writeTargets: CommandWord[] = []
  let readTargets: CommandWord[] = []
  let text = ''
  let started = false
  let dynamic = false
  let glob = false
  let quoted = false
  let unquoted = false
  let quote: 'single' | 'double' | undefined
  let pending: 'write' | 'read' | undefined

  const flushWord = (): void => {
    if (!started) return
    const word: CommandWord = { text, dynamic, glob, quoted, fullyQuoted: quoted && !unquoted }
    if (pending === 'write') writeTargets.push(word)
    else if (pending === 'read') readTargets.push(word)
    else words.push(word)
    pending = undefined
    text = ''
    started = false
    dynamic = false
    glob = false
    quoted = false
    unquoted = false
  }
  const flushSegment = (): void => {
    flushWord()
    if (words.length > 0 || writeTargets.length > 0 || readTargets.length > 0) {
      segments.push({ words, writeTargets, readTargets })
    }
    words = []
    writeTargets = []
    readTargets = []
    pending = undefined
  }

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] as string

    if (quote === 'single') {
      if (char === "'") {
        quote = undefined
        continue
      }
      text += char
      continue
    }

    if (quote === 'double') {
      if (shell === 'bash' && char === '\\') {
        const next = input[index + 1]
        if (next === undefined) return opaque('the command line ends inside an escape')
        if ('\\"$`\n'.includes(next)) {
          text += next
          index += 1
          continue
        }
        text += char
        continue
      }
      if (char === '`') {
        return opaque(shell === 'bash'
          ? 'command substitution cannot be read statically'
          : 'PowerShell escape sequences cannot be read statically')
      }
      if (char === '"') {
        quote = undefined
        continue
      }
      if (char === '$') {
        const expansion = readExpansion(input, index, shell)
        if (expansion === undefined) return opaque('command substitution cannot be read statically')
        text += expansion
        dynamic = true
        index += expansion.length - 1
        continue
      }
      text += char
      continue
    }

    if (char === '\n' || char === '\r') {
      flushSegment()
      continue
    }
    if (/\s/.test(char)) {
      flushWord()
      continue
    }
    if (char === "'") {
      quote = 'single'
      started = true
      quoted = true
      continue
    }
    if (char === '"') {
      quote = 'double'
      started = true
      quoted = true
      continue
    }
    if (shell === 'bash' && char === '\\') {
      const next = input[index + 1]
      if (next === undefined) return opaque('the command line ends inside an escape')
      index += 1
      if (next === '\n') continue
      text += next
      started = true
      quoted = true
      unquoted = true
      continue
    }
    if (char === '`') {
      return opaque(shell === 'bash'
        ? 'command substitution cannot be read statically'
        : 'PowerShell escape sequences cannot be read statically')
    }
    if (char === '$') {
      const expansion = readExpansion(input, index, shell)
      if (expansion === undefined) return opaque('command substitution cannot be read statically')
      text += expansion
      started = true
      dynamic = true
      unquoted = true
      index += expansion.length - 1
      continue
    }
    if (char === '#' && !started) {
      while (index + 1 < input.length && input[index + 1] !== '\n') index += 1
      continue
    }
    if (shell === 'pwsh' && char === '%' && matchAt(CMD_VARIABLE, input, index) !== undefined) {
      return opaque('cmd-style variable expansion cannot be read statically')
    }
    if (char === '&') {
      if (input[index + 1] === '&') {
        flushSegment()
        index += 1
        continue
      }
      const merged = matchAt(MERGED_REDIRECT, input, index)
      if (merged !== undefined) {
        flushWord()
        pending = 'write'
        index += merged.length - 1
        continue
      }
      flushSegment()
      continue
    }
    if (char === '|') {
      if (input[index + 1] === '|') index += 1
      flushSegment()
      continue
    }
    if (char === ';') {
      flushSegment()
      continue
    }
    if (char === '>' || char === '<') {
      if (input.startsWith('<<', index)) return opaque('here-document input cannot be read statically')
      if (started && !quoted && !dynamic && !glob && /^[0-9]+$/.test(text)) {
        text = ''
        started = false
      } else {
        flushWord()
      }
      const duplication = matchAt(DESCRIPTOR_DUPLICATION, input, index)
      if (duplication !== undefined) {
        index += duplication.length - 1
        continue
      }
      const operator = matchAt(REDIRECT_OPERATOR, input, index) as string
      pending = char === '>' ? 'write' : 'read'
      index += operator.length - 1
      continue
    }
    if (char === '{' && input[index + 1] === '}' && !started && (input[index + 2] === undefined || /\s/.test(input[index + 2] as string))) {
      // `find -exec ... {} \;` uses an exact literal placeholder. It is not
      // brace expansion, and treating it as one made routine read-only
      // inspection impossible. Other braces remain opaque.
      text = '{}'
      started = true
      unquoted = true
      index += 1
      continue
    }
    if ('(){}'.includes(char)) return opaque('shell grouping or brace expansion cannot be read statically')
    if (char === '*' || char === '?') {
      glob = true
    }
    text += char
    started = true
    unquoted = true
  }

  if (quote !== undefined) return opaque('the command line ends inside an unbalanced quote')
  if (pending !== undefined && !started) return opaque('a redirection has no target')
  flushSegment()
  if (segments.length === 0) return opaque('the command line contains no command')
  return { kind: 'segments', segments }
}

/** Parse one fully static shell command for helpers that need exact words. */
export function parseSimpleCommand(source: string, shell: ShellKind): ParsedCommand | undefined {
  const decomposition = decomposeCommandLine(source, shell)
  if (decomposition.kind === 'opaque' || decomposition.segments.length !== 1) return undefined
  const segment = decomposition.segments[0] as ShellSegment
  if (segment.writeTargets.length > 0 || segment.readTargets.length > 0) return undefined
  if (segment.words.some(word => word.dynamic || word.glob)) return undefined
  const tokens = segment.words.map(word => word.text)
  if (tokens.length === 0 || tokens[0]?.includes('=') === true) return undefined
  return { tokens }
}


/** No lexical parser can prove the behavior of installed programs or scripts. */
export function hardDenyShellReason(_source: string, _shell: ShellKind, _roots: PolicyRoots): string {
  return 'Auto blocks shell commands, scripts, builds and package lifecycle code: no independently isolated execution broker is available'
}

/** Legacy signature retained; artifact origin never grants execution. */
export function assessShell(source: string, shell: ShellKind, roots: PolicyRoots, _artifacts?: ArtifactRegistry, _owner?: object): Assessment {
  return { decision: 'deny', reason: hardDenyShellReason(source, shell, roots), classifierEligible: false }
}
