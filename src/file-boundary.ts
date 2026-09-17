import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { hardDestructiveTargetReason, isWithin, normalizePath, type PolicyRoots } from './paths.js'

/** Reject ambiguous names before normalization can erase their meaning. */
export function ambiguousPathReason(input: string, windows = process.platform === 'win32'): string | undefined {
  if (!input || input.length > 4096 || /[\x00-\x1f\x7f*?]/.test(input)) return 'empty, oversized, control-character or wildcard path'
  if (input.startsWith('~')) return 'home expansion is not a literal path'
  if (!windows) return input.includes('\\') ? 'foreign path separator' : undefined
  const path = input.replaceAll('/', '\\')
  if (path.startsWith('\\')) return 'UNC, rooted or device namespace path'
  if (/^[a-z]:(?!\\)/i.test(path)) return 'drive-relative path'
  const tail = path.replace(/^[a-z]:\\/i, '')
  if (/[:<>"|]/.test(tail)) return 'alternate data stream or invalid path character'
  for (const part of tail.split('\\')) {
    if (part === '..') return 'parent traversal'
    if (part === '.') continue
    if (/[ .]$/.test(part) || /~\d/i.test(part)) return 'trailing-dot/space or short-name alias'
    if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)) return 'reserved Windows device'
  }
  return undefined
}

export interface FileBoundary { readonly path: string; readonly identity: string }

/**
 * Inspect the actual local file and every ancestor. No links are followed for
 * authorization. This is a last-moment check, not an atomic OS file capability.
 * Trusted host/filesystem code must still prevent a concurrent replacement
 * between the tool guard and its own open/write operation.
 */
export function inspectStructuredPath(input: string, roots: PolicyRoots, mutation: boolean): FileBoundary {
  const ambiguous = ambiguousPathReason(input) ?? ambiguousPathReason(roots.workspace)
  if (ambiguous) throw Error(ambiguous)
  const workspace = normalizePath(roots.workspace, roots.workspace)
  if (!isAbsolute(workspace) || hardDestructiveTargetReason(workspace, roots)) throw Error('unsafe workspace root')
  const target = resolve(workspace, input)
  if (!isWithin(workspace, target) || normalizePath(target, workspace) === workspace) throw Error('target must be a file strictly inside the workspace')
  if (hardDestructiveTargetReason(target, roots)) throw Error('protected file target')
  const parts: string[] = []
  let current = target
  while (true) {
    parts.unshift(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  const identity: unknown[] = []
  for (const part of parts) {
    let info
    try { info = lstatSync(part, { bigint: true }) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && part === target && mutation) {
        identity.push([part, 'absent'])
        continue
      }
      throw Error('file or ancestor is unavailable')
    }
    if (info.isSymbolicLink()) throw Error('symbolic links and junctions are not authorized')
    // Detect realpath aliases that lstat alone might not identify.
    if (normalizePath(realpathSync.native(part), workspace) !== normalizePath(part, workspace)) throw Error('filesystem alias is not authorized')
    if (part !== target) {
      if (!info.isDirectory()) throw Error('ancestor is not a directory')
      identity.push([part, String(info.dev), String(info.ino), String(info.mode)])
    } else {
      if (!info.isFile() || info.nlink !== 1n) throw Error('target must be a regular file with exactly one link')
      if (info.size > 16n * 1024n * 1024n) throw Error('file exceeds the 16 MiB exact-review limit')
      identity.push([part, String(info.dev), String(info.ino), String(info.mode), String(info.ctimeNs), String(info.mtimeNs), String(info.size),
        createHash('sha256').update(readFileSync(part)).digest('hex')])
    }
  }
  return { path: normalizePath(target, workspace), identity: JSON.stringify(identity) }
}
