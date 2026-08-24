/**
 * SVN operations for the dsh-svn-plugin source-control panel. Everything
 * goes through the system `svn` binary spawned per request (no library, no
 * state), with `--xml` output formats so parsing never depends on locale or
 * color config. All commands run with `--non-interactive` so a missing
 * credential prompt can never hang the panel, and a hard timeout bounds the
 * wait.
 *
 * Windows note: TortoiseSVN ships `svn.exe` on PATH (D:\TortoiseSVN\bin).
 * The spawn uses the bare binary name so any configured PATH entry wins.
 */
import { spawn } from 'node:child_process'

/** One `svn status` entry (parsed from --xml). */
export interface SvnStatusEntry {
  /** Repository-relative or cwd-relative display path (as svn reports it). */
  path: string
  /** One-letter work-copy status: A/C/D/I/M/R/X/!/~/?/conflicted etc. */
  item: string
  /** Whether properties changed. */
  props: string
  /** Revision of the item in the working copy (0 for unversioned). */
  revision: number
  /** Last-committed revision (from the entry's <commit>), when present. */
  lastChangedRevision?: number
  /** Last-committed author, when present. */
  lastChangedAuthor?: string
  /** Set by the API layer: unversioned path matches a .gitignore rule. */
  gitignored?: boolean
}

/** The status snapshot: repo identity + the changed/unchanged entry list. */
export interface SvnStatusResult {
  isWorkCopy: boolean
  /** Repository URL (svn info --show-item url), when resolvable. */
  url?: string
  /** Current working-copy revision, when resolvable. */
  revision?: number
  entries: SvnStatusEntry[]
}

/** One `svn log` row (parsed from --xml). */
export interface SvnLogEntry {
  /** Numeric revision string, e.g. '123'. */
  revision: string
  author: string
  /** ISO 8601 date as svn emits it, e.g. '2024-01-01T10:00:00.000000Z'. */
  date: string
  message: string
  /** Changed paths (action + path); empty when the log ran without -v. */
  changedPaths: Array<{ action: string; path: string; kind: string }>
}

/** One `svn blame` line (parsed from --xml). */
export interface SvnBlameLine {
  lineNumber: number
  revision: string
  author: string
  text: string
}

/** One `svn info` entry (parsed from --xml). */
export interface SvnInfoResult {
  isWorkCopy: boolean
  url?: string
  reposRoot?: string
  reposUuid?: string
  revision?: number
  lastChangedRevision?: number
  lastChangedAuthor?: string
  schedule?: string
  wcRoot?: string
  depth?: string
}

/** One shelve (--list) row: name, keep, version, and change summary. */
export interface SvnShelveEntry {
  name: string
  /** true when the shelve is a "keep" shelve (svn 1.14+). */
  keep: boolean
  /** Shelve version (1..n). */
  version: number
  /** Raw summary line (paths + change counts). */
  summary: string
}

/** One `svn list` row (parsed from --xml). */
export interface SvnListEntry {
  name: string
  kind: 'file' | 'dir' | string
  size?: number
  revision?: number
  author?: string
  date?: string
}

/** One svn failure (stderr text as the message). */
export class SvnCommandError extends Error {
  constructor(
    message: string,
    readonly code = 'svn-error',
    readonly command: string,
    readonly exitCode?: number,
  ) {
    super(message)
  }
}

/** Default per-command timeout (ms). */
const DEFAULT_TIMEOUT_MS = 60_000

/**
 * Detect which optional `svn` subcommands this client supports. TortoiseSVN's
 * bundled `svn.exe` deliberately omits `shelve` (and its helpers), while the
 * upstream Apache binaries and other vendors ship it — so the UI must degrade
 * gracefully instead of hard-failing on `shelve`.
 */
export async function detectCapabilities(): Promise<{ shelve: boolean }> {
  try {
    const out = await runSvn(process.cwd(), ['help'], 15_000)
    return { shelve: /\bshelve\b/.test(out) }
  } catch {
    return { shelve: false }
  }
}

/**
 * Run one svn command; resolves with stdout, rejects with SvnCommandError.
 * Always passes `--non-interactive` first so credential prompts cannot hang.
 * Exit codes in `tolerateExitCodes` are treated as success (svn diff returns
 * 1 when differences exist; svn propget returns 1 when a property is absent).
 * Tolerated exits still fail when stderr carries a real `svn: E…` error
 * (e.g. E160013 / E155007), so callers never see a silent empty result.
 */
export function runSvn(
  cwd: string,
  args: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  tolerateExitCodes: readonly number[] = [],
): Promise<string> {
  const full = ['--non-interactive', ...args]
  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn('svn', full, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, LC_ALL: 'C' },
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new SvnCommandError(`svn ${args[0] ?? ''} timed out after ${timeoutMs}ms`, 'svn-error', args.join(' ')))
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new SvnCommandError(`cannot run svn: ${error.message}`, 'svn-error', args.join(' ')))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const exitCode = code ?? -1
      const tolerated = exitCode === 0 || tolerateExitCodes.includes(exitCode)
      if (tolerated && !/svn:\s*E\d+/.test(stderr)) {
        resolvePromise(stdout)
      } else {
        reject(new SvnCommandError(stderr.trim() || `svn exited with ${String(exitCode)}`, 'svn-error', args.join(' '), exitCode))
      }
    })
  })
}

/**
 * Minimal XML parser for svn's --xml output. svn emits simple well-formed
 * XML (an <?xml?> declaration, nested elements, attributes, entity-escaped
 * text; svn never uses CDATA or namespaces in the surfaces we parse). This
 * builds a tiny tree: `{tag, attrs, children, text}`.
 */
interface XmlNode {
  tag: string
  attrs: Record<string, string>
  children: XmlNode[]
  /** Concatenated text directly inside this element (not children). */
  text: string
}

const XML_ENTITY: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&apos;': "'",
  '&quot;': '"',
}

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(/&(lt|gt|amp|apos|quot);/g, (_m, name: string) => XML_ENTITY[`&${name};`] ?? _m)
}

/** Parse svn --xml output into the root element. */
export function parseSvnXml(xml: string): XmlNode {
  // Strip the <?xml ...?> declaration; svn emits exactly one at the head.
  const body = xml.replace(/^\uFEFF/, '').replace(/<\?xml[^>]*\?>\s*/, '')
  const root = parseElement(body, 0)
  return root.node
}

function parseElement(input: string, start: number): { node: XmlNode; end: number } {
  // Expect '<tag ...>' at `start`.
  const tagStart = input.indexOf('<', start)
  if (tagStart === -1 || input[tagStart + 1] === '/') {
    throw new SvnCommandError(`svn xml: expected element at offset ${start}`, 'svn-error', 'parse-xml')
  }
  // Read the tag name.
  let i = tagStart + 1
  let name = ''
  while (i < input.length && !/[\s/>]/.test(input[i]!)) {
    name += input[i]
    i += 1
  }
  const attrs: Record<string, string> = {}
  // Read attributes until '>' or '/>'.
  while (i < input.length) {
    // Skip whitespace.
    while (i < input.length && /\s/.test(input[i]!)) i += 1
    const ch = input[i]
    if (ch === '>') { i += 1; break }
    if (ch === '/' && input[i + 1] === '>') {
      // Self-closing.
      return { node: { tag: name, attrs, children: [], text: '' }, end: i + 2 }
    }
    // attribute name
    let attrName = ''
    while (i < input.length && !/[\s=/>]/.test(input[i]!)) { attrName += input[i]; i += 1 }
    while (i < input.length && /\s/.test(input[i]!)) i += 1
    if (input[i] === '=') {
      i += 1
      while (i < input.length && /\s/.test(input[i]!)) i += 1
      const quote = input[i]
      if (quote === '"' || quote === "'") {
        i += 1
        let value = ''
        while (i < input.length && input[i] !== quote) { value += input[i]; i += 1 }
        i += 1 // closing quote
        attrs[attrName] = decodeEntities(value)
      }
    }
  }
  const node: XmlNode = { tag: name, attrs, children: [], text: '' }
  // Parse children / text until the matching close tag.
  let textBuf = ''
  while (i < input.length) {
    const next = input.indexOf('<', i)
    if (next === -1) break
    textBuf += input.slice(i, next)
    if (input[next + 1] === '/') {
      // closing tag
      const closeEnd = input.indexOf('>', next)
      if (closeEnd === -1) break
      node.text = decodeEntities(textBuf)
      return { node, end: closeEnd + 1 }
    }
    // Preserve inter-element text (usually whitespace) — keep it trimmed-only
    // for svn's formatting; we expose `text` as the trimmed inner text later.
    const child = parseElement(input, next)
    node.children.push(child.node)
    i = child.end
  }
  node.text = decodeEntities(textBuf)
  return { node, end: i }
}

/** Find the first descendant child with the given tag (depth-first). */
function child(node: XmlNode | undefined, tag: string): XmlNode | undefined {
  if (node === undefined) return undefined
  for (const c of node.children) {
    if (c.tag === tag) return c
    const deep = child(c, tag)
    if (deep !== undefined) return deep
  }
  return undefined
}

/** All descendant children with the given tag (depth-first, pre-order). */
function children(node: XmlNode | undefined, tag: string): XmlNode[] {
  if (node === undefined) return []
  const out: XmlNode[] = []
  const walk = (n: XmlNode): void => {
    for (const c of n.children) {
      if (c.tag === tag) out.push(c)
      walk(c)
    }
  }
  walk(node)
  return out
}

/** Trimmed inner text of a node (children concatenated, entities decoded). */
function textOf(node: XmlNode | undefined): string {
  if (node === undefined) return ''
  return node.text.trim()
}

/** Whether the directory is a Subversion working copy (exit-0 `svn info`). */
export async function isWorkCopy(cwd: string): Promise<boolean> {
  try {
    await runSvn(cwd, ['info'])
    return true
  } catch {
    return false
  }
}

/** Working-copy info (--xml). */
export async function info(cwd: string): Promise<SvnInfoResult> {
  try {
    const out = await runSvn(cwd, ['info', '--xml'])
    const root = parseSvnXml(out)
    const entry = root.children.find(c => c.tag === 'entry') ?? root
    const url = textOf(child(entry, 'url')) || undefined
    const reposRoot = textOf(child(entry, 'root')) || undefined
    const reposUuid = textOf(child(entry, 'uuid')) || undefined
    const revision = entry.attrs.revision !== undefined ? Number(entry.attrs.revision) : undefined
    const commit = child(entry, 'commit')
    const wcInfo = child(entry, 'wc-info')
    return {
      isWorkCopy: true,
      url,
      reposRoot,
      reposUuid,
      revision,
      lastChangedRevision: commit?.attrs.revision !== undefined ? Number(commit.attrs.revision) : undefined,
      lastChangedAuthor: textOf(child(commit, 'author')) || undefined,
      schedule: textOf(child(wcInfo, 'schedule')) || undefined,
      wcRoot: textOf(child(wcInfo, 'wcroot-abspath')) || undefined,
      depth: textOf(child(wcInfo, 'depth')) || undefined,
    }
  } catch {
    return { isWorkCopy: false }
  }
}

/** Working-tree status (--xml, including unversioned/ignored per flags). */
export async function status(cwd: string, opts: { showIgnored?: boolean } = {}): Promise<SvnStatusResult> {
  const args = ['status', '--xml']
  if (opts.showIgnored === true) args.push('--no-ignore')
  try {
    const out = await runSvn(cwd, args)
    const root = parseSvnXml(out)
    const entries: SvnStatusEntry[] = []
    for (const entry of children(root, 'entry')) {
      const wc = child(entry, 'wc-status')
      if (wc === undefined) continue
      const commit = child(wc, 'commit')
      entries.push({
        path: entry.attrs.path ?? '',
        item: wc.attrs.item ?? '?',
        props: wc.attrs.props ?? 'none',
        revision: wc.attrs.revision !== undefined ? Number(wc.attrs.revision) : 0,
        lastChangedRevision: commit?.attrs.revision !== undefined ? Number(commit.attrs.revision) : undefined,
        lastChangedAuthor: textOf(child(commit, 'author')) || undefined,
      })
    }
    const infoResult = await info(cwd)
    return {
      isWorkCopy: true,
      url: infoResult.url,
      revision: infoResult.revision,
      entries,
    }
  } catch {
    return { isWorkCopy: false, entries: [] }
  }
}

/** Commit log (--xml, -v for changed paths). Changed paths come back from
 *  svn as repository paths (e.g. `/trunk/src/a.ts`); they are re-based onto
 *  the working-copy root so the UI can hand them straight to `svn diff`.
 *  Paths outside the working-copy subtree are kept as repository paths. */
export async function log(
  cwd: string,
  opts: { limit?: number; path?: string } = {},
): Promise<SvnLogEntry[]> {
  const args = ['log', '--xml', '-v']
  if (opts.limit !== undefined) args.push('-l', String(opts.limit))
  if (opts.path !== undefined && opts.path !== '') args.push(opts.path)
  const out = await runSvn(cwd, args)
  const root = parseSvnXml(out)
  // Repo-relative prefix of the cwd (e.g. `/trunk` or `/trunk/src`).
  let wcPrefix: string | null = null
  try {
    const i = await info(cwd)
    if (i.url !== undefined && i.reposRoot !== undefined && i.url.startsWith(i.reposRoot)) {
      wcPrefix = i.url.slice(i.reposRoot.length)
    }
  } catch { /* keep null: paths stay as-is */ }
  const entries: SvnLogEntry[] = []
  for (const entry of children(root, 'logentry')) {
    const changedPaths: Array<{ action: string; path: string; kind: string }> = []
    const pathsEl = child(entry, 'paths')
    if (pathsEl !== undefined) {
      for (const p of children(pathsEl, 'path')) {
        let path = textOf(p)
        if (wcPrefix !== null && path.startsWith(wcPrefix)) {
          path = path.slice(wcPrefix.length).replace(/^\/+/, '')
          if (path === '') path = '.'
        }
        changedPaths.push({ action: p.attrs.action ?? '', path, kind: p.attrs.kind ?? '' })
      }
    }
    entries.push({
      revision: entry.attrs.revision ?? '',
      author: textOf(child(entry, 'author')),
      date: textOf(child(entry, 'date')),
      message: textOf(child(entry, 'msg')),
      changedPaths,
    })
  }
  return entries
}

/**
 * Diff text (working copy vs BASE, or between two revisions).
 *
 * For revision-range diffs we always diff **repository targets** (`^/…@rev`)
 * instead of working-copy paths: `svn diff -r N-1:N <wc-path>` needs the node
 * to exist in the working copy, which fails for added/deleted entries whose
 * parent dirs are absent (E155010). Repository-target diffs work for A/M/D
 * alike. The path is re-based onto the cwd's repo prefix (the `log()` layer
 * hands us wc-relative paths for entries inside the wc subtree).
 */
export async function diff(
  cwd: string,
  opts: { path?: string; rev1?: string; rev2?: string } = {},
): Promise<string> {
  const hasRange = opts.rev1 !== undefined && opts.rev2 !== undefined
  const hasPath = opts.path !== undefined && opts.path !== ''
  if (hasRange && hasPath) {
    const repoPath = await toRepoPath(cwd, opts.path!)
    // `--old`/`--new` with peg revisions keeps added/deleted nodes resolvable.
    const out = await runSvn(cwd, ['diff', '--old', `${repoPath}@${opts.rev1}`, '--new', `${repoPath}@${opts.rev2}`], DEFAULT_TIMEOUT_MS, [1])
    return out
  }
  const args = ['diff']
  if (hasRange) args.push('-r', `${opts.rev1}:${opts.rev2}`)
  if (hasPath) args.push(opts.path!)
  // svn diff exit code is 1 when differences exist — treat that as success.
  const out = await runSvn(cwd, args, DEFAULT_TIMEOUT_MS, [1])
  return out
}

/** Re-base a wc-relative path onto the cwd's repository URL prefix so it can
 *  be diffed as a repository target. Falls back to the raw path when the
 *  prefix cannot be resolved. */
async function toRepoPath(cwd: string, path: string): Promise<string> {
  if (path.startsWith('/')) return `^${path}`
  try {
    const i = await info(cwd)
    if (i.url !== undefined && i.reposRoot !== undefined && i.url.startsWith(i.reposRoot)) {
      const prefix = i.url.slice(i.reposRoot.length).replace(/\/+$/, '')
      return `^${prefix}/${path.replace(/^\/+/, '')}`
    }
  } catch { /* fall through */ }
  return `^/${path}`
}

/** Blame (--xml). */
export async function blame(cwd: string, path: string): Promise<SvnBlameLine[]> {
  const out = await runSvn(cwd, ['blame', '--xml', path])
  const root = parseSvnXml(out)
  const lines: SvnBlameLine[] = []
  for (const entry of children(root, 'entry')) {
    const commit = child(entry, 'commit')
    lines.push({
      lineNumber: Number(entry.attrs['line-number'] ?? '0'),
      revision: commit?.attrs.revision ?? '',
      author: textOf(child(commit, 'author')),
      text: textOf(child(entry, 'line')),
    })
  }
  return lines
}

/** Commit the given targets with a message. */
export async function commit(cwd: string, message: string, targets: string[]): Promise<{ revision: string }> {
  const args = ['commit', '-m', message, ...targets]
  const out = await runSvn(cwd, args)
  const match = /Committed revision\s+(\d+)/.exec(out) ?? /revision\s+(\d+)/.exec(out)
  return { revision: match?.[1] ?? '' }
}

/** Update the working copy (targets optional). */
export async function update(cwd: string, targets: string[] = []): Promise<string> {
  return runSvn(cwd, ['update', ...targets])
}

/** Revert the given targets (recursive by default). */
export async function revert(cwd: string, targets: string[], depth?: string): Promise<string> {
  const args = ['revert', ...(depth !== undefined && depth !== '' ? ['--depth', depth] : []), ...targets]
  return runSvn(cwd, args)
}

/** Resolve a conflict with the given accept policy. */
export async function resolve(cwd: string, target: string, accept: string, recursive = false): Promise<string> {
  const args = ['resolve', '--accept', accept]
  if (recursive) args.push('-R')
  args.push(target)
  return runSvn(cwd, args)
}

/** Add files/directories (recursive). */
export async function add(cwd: string, targets: string[], recursive = true): Promise<string> {
  const args = ['add']
  if (recursive) args.push('--parents')
  return runSvn(cwd, [...args, ...targets])
}

/** Remove (versioned) files/directories, keeping local copies. */
export async function remove(cwd: string, targets: string[]): Promise<string> {
  return runSvn(cwd, ['remove', '--keep-local', ...targets])
}

/** Move/rename a versioned path. */
export async function move(cwd: string, from: string, to: string): Promise<string> {
  return runSvn(cwd, ['move', from, to])
}

/** Switch the working copy (or a target) to another URL. */
export async function switchTo(cwd: string, url: string, target?: string): Promise<string> {
  const args = ['switch', url]
  if (target !== undefined && target !== '') args.push(target)
  return runSvn(cwd, args)
}

/** Merge changes from a URL (or a range of revisions) into the working copy. */
export async function merge(cwd: string, url: string, rev1?: string, rev2?: string): Promise<string> {
  const args = ['merge']
  if (rev1 !== undefined && rev2 !== undefined) args.push('-r', `${rev1}:${rev2}`)
  args.push(url)
  // svn merge exits 1 when conflicts were resolved — treat as success.
  return runSvn(cwd, args, DEFAULT_TIMEOUT_MS, [1])
}

/** Create a branch/tag by copying a URL to another URL with a message. */
export async function copyUrl(cwd: string, fromUrl: string, toUrl: string, message: string): Promise<string> {
  return runSvn(cwd, ['copy', fromUrl, toUrl, '-m', message])
}

/** Checkout a repository URL into a local directory. */
export async function checkout(cwd: string, url: string, target?: string): Promise<string> {
  const args = ['checkout', url]
  if (target !== undefined && target !== '') args.push(target)
  return runSvn(cwd, args)
}

/** List a repository URL (--xml). Runs from `cwd` so svn's auth/config
 *  (servers, auth cache) resolves the same way as the session's other
 *  commands. */
export async function list(cwd: string, url: string, revision?: string): Promise<SvnListEntry[]> {
  const args = ['list', '--xml']
  if (revision !== undefined && revision !== '') args.push('-r', revision)
  args.push(url)
  const out = await runSvn(cwd, args)
  const root = parseSvnXml(out)
  const entries: SvnListEntry[] = []
  for (const entry of children(root, 'entry')) {
    const commit = child(entry, 'commit')
    entries.push({
      name: textOf(child(entry, 'name')),
      kind: entry.attrs.kind ?? '',
      size: child(entry, 'size') !== undefined ? Number(textOf(child(entry, 'size'))) : undefined,
      revision: commit?.attrs.revision !== undefined ? Number(commit.attrs.revision) : undefined,
      author: textOf(child(commit, 'author')) || undefined,
      date: textOf(child(commit, 'date')) || undefined,
    })
  }
  return entries
}

/** Cleanup (remove stale locks; optionally vacuum pristine copies). */
export async function cleanup(cwd: string, vacuum = false): Promise<string> {
  const args = ['cleanup']
  if (vacuum) args.push('--vacuum-pristines')
  return runSvn(cwd, args)
}

/** Shelve pending changes (svn 1.10+). */
export async function shelve(cwd: string, name: string, targets: string[], keep = false): Promise<string> {
  const args = ['shelve', '--keep-local', name]
  if (keep) args.push('--keep')
  return runSvn(cwd, [...args, ...targets])
}

/** Unshelve a shelved change set back into the working copy. */
export async function unshelve(cwd: string, name: string, drop = false): Promise<string> {
  const args = ['unshelve']
  if (drop) args.push('--drop')
  args.push(name)
  return runSvn(cwd, args)
}

/** Delete a shelved change set. */
export async function shelveDelete(cwd: string, name: string): Promise<string> {
  return runSvn(cwd, ['shelve-delete', name])
}

/** List shelved change sets (--list; text output, names + summaries). */
export async function shelveList(cwd: string): Promise<SvnShelveEntry[]> {
  try {
    const out = await runSvn(cwd, ['shelve', '--list'])
    const entries: SvnShelveEntry[] = []
    for (const rawLine of out.split('\n')) {
      const line = rawLine.replace(/\r$/, '')
      if (line.trim() === '') continue
      // Format: `name (keep) [v1]  M path1, path2`
      const keep = line.includes('(keep)')
      const name = line.trim().split(/\s+/)[0] ?? ''
      const verMatch = /\[v(\d+)\]/.exec(line)
      entries.push({ name, keep, version: verMatch !== null ? Number(verMatch[1]) : 1, summary: line.trim() })
    }
    return entries
  } catch {
    return []
  }
}

/** Get a property value (propget). Returns '' when the property is absent
 *  (svn exits 1 with a W200017 warning in that case). */
export async function propget(cwd: string, propName: string, target: string): Promise<string> {
  const out = await runSvn(cwd, ['propget', propName, target], DEFAULT_TIMEOUT_MS, [1])
  return out.trim()
}

/** Set a property value (propset). */
export async function propset(cwd: string, propName: string, value: string, target: string): Promise<string> {
  return runSvn(cwd, ['propset', propName, value, target])
}

/** List properties (proplist --verbose). */
export async function proplist(cwd: string, target: string): Promise<Array<{ name: string; value: string }>> {
  const out = await runSvn(cwd, ['proplist', '--verbose', target])
  const props: Array<{ name: string; value: string }> = []
  for (const rawLine of out.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (line === '' || !line.includes(':')) continue
    const idx = line.indexOf(':')
    props.push({ name: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() })
  }
  return props
}

/** Assign a file to a changelist (or remove with --remove, which takes
 *  only paths — `svn changelist --remove PATH...`). */
export async function changelist(cwd: string, name: string, target: string, remove = false): Promise<string> {
  if (remove) {
    return runSvn(cwd, ['changelist', '--remove', target])
  }
  return runSvn(cwd, ['changelist', name, target])
}

/** List changelists and their member paths (via `svn status --xml`'s
 *  <changelist> elements — `svn changelist` itself has no listing mode). */
export async function changelists(cwd: string): Promise<Array<{ name: string; paths: string[] }>> {
  const out = await runSvn(cwd, ['status', '--xml'])
  const root = parseSvnXml(out)
  const groups: Array<{ name: string; paths: string[] }> = []
  for (const cl of root.children.filter(c => c.tag === 'changelist')) {
    const name = cl.attrs.name ?? ''
    const paths = children(cl, 'entry').map(e => e.attrs.path ?? '').filter(p => p !== '')
    groups.push({ name, paths })
  }
  return groups
}

/** Lock files. */
export async function lock(cwd: string, targets: string[], message?: string): Promise<string> {
  const args = ['lock']
  if (message !== undefined && message !== '') args.push('-m', message)
  return runSvn(cwd, [...args, ...targets])
}

/** Unlock files (force option). */
export async function unlock(cwd: string, targets: string[], force = false): Promise<string> {
  const args = ['unlock']
  if (force) args.push('--force')
  return runSvn(cwd, [...args, ...targets])
}

/** Show working-copy or repository path info for a remote URL (svn info URL). */
export async function infoUrl(cwd: string, url: string): Promise<SvnInfoResult> {
  try {
    const out = await runSvn(cwd, ['info', '--xml', url])
    const root = parseSvnXml(out)
    const entry = root.children.find(c => c.tag === 'entry') ?? root
    const commit = child(entry, 'commit')
    return {
      isWorkCopy: true,
      url: textOf(child(entry, 'url')) || url,
      reposRoot: textOf(child(entry, 'root')) || undefined,
      reposUuid: textOf(child(entry, 'uuid')) || undefined,
      revision: entry.attrs.revision !== undefined ? Number(entry.attrs.revision) : undefined,
      lastChangedRevision: commit?.attrs.revision !== undefined ? Number(commit.attrs.revision) : undefined,
      lastChangedAuthor: textOf(child(commit, 'author')) || undefined,
    }
  } catch {
    return { isWorkCopy: false }
  }
}
