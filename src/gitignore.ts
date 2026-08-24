/**
 * .gitignore support for the SVN panel. Subversion itself ignores via the
 * `svn:ignore` property, but many working copies keep a `.gitignore` file at
 * the root (often for IDE/editor artifacts). This module parses gitignore
 * syntax (the git check-ignore ruleset) and marks `svn status` unversioned
 * entries as ignored-by-gitignore so the UI can hide them like Git does.
 *
 * Grammar implemented (subset of gitignore(5)):
 *   - blank lines and lines starting with `#` are comments
 *   - a trailing `/` restricts the rule to directories
 *   - a leading `/` anchors the rule to the .gitignore's own directory
 *   - patterns without `/` match the basename at any depth
 *   - `*` matches anything except `/`, `?` matches one non-`/` char
 *   - `**` matches zero or more path segments
 *   - a leading `!` negates (re-includes) previously ignored paths
 *   - the LAST matching rule wins (later rules override earlier ones)
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

/** One parsed gitignore rule. */
export interface GitignoreRule {
  negated: boolean
  /** Trailing `/` — only directories (and everything inside them). */
  dirOnly: boolean
  /** Leading `/` — anchored to the .gitignore's directory. */
  anchored: boolean
  /** Pattern split into path segments ('' = the rule matches any depth). */
  segments: string[]
}

/** Parse the text of one .gitignore file into rules (in file order). */
export function parseGitignore(text: string): GitignoreRule[] {
  const rules: GitignoreRule[] = []
  for (let raw of text.split(/\r?\n/)) {
    // Trim trailing whitespace (git trims spaces/tabs at line end).
    raw = raw.replace(/[\s]+$/, '')
    if (raw === '') continue
    if (raw.startsWith('#')) continue
    // Escape the escape char first so `\#` stays literal.
    let line = raw
    const negated = line.startsWith('!')
    if (negated) line = line.slice(1)
    if (line === '') continue
    let dirOnly = false
    if (line.endsWith('/')) {
      dirOnly = true
      line = line.slice(0, -1)
    }
    if (line === '') continue
    let anchored = false
    if (line.startsWith('/')) {
      anchored = true
      line = line.slice(1)
    }
    // A pattern containing a '/' anywhere (after a leading '/') is anchored
    // relative to the .gitignore file; a bare name matches at any depth.
    if (line.includes('/')) anchored = true
    const segments = line.split('/').filter(s => s !== '')
    if (segments.length === 0) continue
    rules.push({ negated, dirOnly, anchored, segments })
  }
  return rules
}

/** Escape a regex special char (kept simple: pattern chars are handled
 *  manually below, so only regex metachars need escaping). */
function escapeRegexChar(ch: string): string {
  return /[.^$+()|[\]{}]/.test(ch) ? `\\${ch}` : ch
}

/** Convert one pattern segment into a regex fragment (no `/` inside). */
function segmentToRegex(segment: string): string {
  let out = ''
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]!
    if (ch === '*') out += '[^/]*'
    else if (ch === '?') out += '[^/]'
    else out += escapeRegexChar(ch)
  }
  return out
}

/**
 * Match `relPath` (a `/`-separated path relative to the .gitignore directory)
 * against the parsed rules. Returns true when the path is ignored, false when
 * not (or re-included by a later `!` rule).
 */
export function isIgnored(relPath: string, rules: GitignoreRule[]): boolean {
  const path = relPath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (path === '') return false
  const pathSegs = path.split('/')
  let ignored = false
  for (const rule of rules) {
    if (matchesRule(pathSegs, rule)) {
      ignored = !rule.negated
    }
  }
  return ignored
}

/** Whether a path matches one rule (checking the path itself and, for
 *  dirOnly rules, every ancestor directory; unanchored rules try every
 *  suffix depth). */
function matchesRule(pathSegs: string[], rule: GitignoreRule): boolean {
  const pat = rule.segments
  const starts = rule.anchored ? [0] : Array.from({ length: pathSegs.length + 1 }, (_, i) => i)
  for (const start of starts) {
    const segs = pathSegs.slice(start)
    if (rule.dirOnly) {
      // Pattern must match a directory prefix of the path (or the whole
      // path when it IS the directory): everything under it is ignored.
      for (let n = pat.length; n <= segs.length; n++) {
        if (matchSegments(pat, segs.slice(0, n))) return true
      }
    } else if (matchSegments(pat, segs)) {
      return true
    }
  }
  return false
}

/** Does one pattern segment match one path segment (supports * and ?)? */
function segmentMatches(pattern: string, value: string): boolean {
  if (pattern === value) return true
  if (!pattern.includes('*') && !pattern.includes('?')) return false
  return new RegExp(`^${segmentToRegex(pattern)}$`).test(value)
}

/** Segment-wise glob match with `**` support. */
function matchSegments(pat: string[], path: string[]): boolean {
  let pi = 0
  let pj = 0
  let starPi = -1
  let starPj = -1
  while (pj < path.length) {
    if (pi < pat.length && pat[pi] === '**') {
      starPi = pi
      starPj = pj
      pi += 1
    } else if (pi < pat.length && segmentMatches(pat[pi]!, path[pj]!)) {
      pi += 1
      pj += 1
    } else if (starPi !== -1) {
      pi = starPi + 1
      starPj += 1
      pj = starPj
    } else {
      return false
    }
  }
  while (pi < pat.length && pat[pi] === '**') pi += 1
  return pi === pat.length
}

/** One collected .gitignore layer (its directory + parsed rules). */
export interface GitignoreLayer {
  /** Absolute directory containing this .gitignore. */
  base: string
  rules: GitignoreRule[]
}

/**
 * Collect every .gitignore from `cwd` upward to the filesystem root
 * (outermost first). Layers outside `cwd` still apply: paths are re-based
 * onto each layer's directory before matching (git semantics).
 */
export function collectGitignoreLayers(cwd: string): GitignoreLayer[] {
  const layers: GitignoreLayer[] = []
  const seen = new Set<string>()
  let dir = resolve(cwd)
  for (;;) {
    if (seen.has(dir)) break
    seen.add(dir)
    const file = resolve(dir, '.gitignore')
    if (existsSync(file)) {
      try {
        const rules = parseGitignore(readFileSync(file, 'utf8'))
        if (rules.length > 0) layers.push({ base: dir, rules })
      } catch { /* unreadable .gitignore: skip */ }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return layers.reverse()
}

/**
 * Whether `relPath` (relative to `cwd`, may be absolute or contain `..`) is
 * ignored by any collected .gitignore layer.
 */
export function isPathIgnored(cwd: string, relPath: string, layers: GitignoreLayer[]): boolean {
  const abs = isAbsolute(relPath) ? resolve(relPath) : resolve(cwd, relPath)
  for (const layer of layers) {
    const rel = relative(layer.base, abs)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) continue
    if (isIgnored(rel.replace(/\\/g, '/'), layer.rules)) return true
  }
  return false
}

/** Convert a Windows-style path to the svn-style `/` form (used for display
 *  and for path keys). */
export function toSvnPath(p: string): string {
  return p.replace(/\\/g, '/')
}

export { sep }
