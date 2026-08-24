/**
 * dsh-svn-plugin host half: the /svn JSON API (status, log, diff, shelve,
 * commit, update, revert, resolve, branch, blame, props, changelist, lock,
 * repository browsing) plus the model-facing `svn_*` tools. Every route
 * passes the same browser-trust fence as the /api gateway — Host-header
 * loopback or the web runtime's `trustedHosts` — read per request from the
 * live service value so the fence tracks the same trust source the /api
 * gateway derives its list from.
 *
 * All operations are conversation-scoped: requests carry a sessionId, the
 * session's authoritative cwd comes from the session store, and every svn
 * command spawns against that cwd.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import * as svn from './svn.ts'
import * as gitignore from './gitignore.ts'
import {
  optionalString,
  readJsonBody,
  requireString,
  SvnError,
  writeError,
  writeJson,
  writeOk,
} from './wire.ts'
import { isTrustedApiRequest } from './trust-fence.ts'

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-svn-plugin'

/**
 * Host services required before apply() may touch ctx.webServer / sessions /
 * tools / webRuntime. Cordis keeps the fiber PENDING until every name is
 * provided — without this list, property access throws "without inject".
 */
export const inject = ['webServer', 'webRuntime', 'sessions', 'tools'] as const

/**
 * Structural host context this plugin consumes. The plugin resolves outside
 * the DSH monorepo's single cordis instance, so the upstream
 * `declare module '@deepseek-ai/cordis'` augmentations DO reach this
 * Context — which is why this file does NOT redeclare them: the real
 * service types already exist and a redeclaration would conflict. We only
 * restate the slices we touch as structural mirrors, and the cordis
 * loader's apply() signature accepts any object-shaped context.
 */
export interface SvnHostContext {
  effect(fn: () => void | (() => void), label?: string): void
  webServer: {
    register(route: {
      kind: 'exact' | 'prefix'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
    }): () => void
  }
  sessions: {
    get(id: string): { header: { cwd?: string } } | undefined
  }
  webRuntime: {
    trustedHosts: readonly string[]
  }
  tools: {
    register(tool: unknown): () => void
  }
  logger?: { warn(message: string): void }
}

/**
 * Resolve a session's authoritative working directory. The attached session
 * header wins; while the session is still hydrating from persistence the
 * caller's own list-summary cwd is used; the process cwd is the last resort.
 */
function sessionCwdOf(ctx: SvnHostContext, sessionId: string, clientCwd?: string): string {
  const session = ctx.sessions.get(sessionId)
  const headerCwd = session?.header.cwd
  if (headerCwd !== undefined && headerCwd !== '') return headerCwd
  if (clientCwd !== undefined && clientCwd !== '') return clientCwd
  return process.cwd()
}

/** One API method dispatch table entry. */
type ApiMethod = (payload: unknown) => Promise<unknown> | unknown

/** Build the API method table bound to the plugin context. */
function buildApi(ctx: SvnHostContext): Record<string, ApiMethod> {
  const cwdOf = (payload: unknown): { sessionId: string; cwd: string } => {
    const sessionId = requireString(payload, 'sessionId')
    const record = payload as { cwd?: unknown } | null
    const clientCwd = typeof record?.cwd === 'string' && record.cwd !== '' ? record.cwd : undefined
    return { sessionId, cwd: sessionCwdOf(ctx, sessionId, clientCwd) }
  }
  const pathsOf = (payload: unknown): string[] => {
    const record = payload as { paths?: unknown } | null
    const raw = record?.paths
    if (raw === undefined || raw === null) return []
    if (!Array.isArray(raw) || !raw.every(p => typeof p === 'string' && p !== '')) {
      throw new SvnError('bad-request', '"paths" must be an array of non-empty strings')
    }
    return raw as string[]
  }
  return {
    'svn.info': (payload) => {
      const { cwd } = cwdOf(payload)
      return svn.info(cwd)
    },
    'svn.capabilities': () => svn.detectCapabilities(),
    'svn.status': async (payload) => {
      const { cwd } = cwdOf(payload)
      const record = payload as { showIgnored?: unknown } | null
      const result = await svn.status(cwd, { showIgnored: record?.showIgnored === true })
      // Mark unversioned entries matched by any .gitignore layer so the UI can
      // hide them by default (Git-style "ignored" files).
      const layers = gitignore.collectGitignoreLayers(cwd)
      if (layers.length > 0) {
        result.entries = result.entries.map(e => ({
          ...e,
          gitignored: e.item === 'unversioned' ? gitignore.isPathIgnored(cwd, e.path, layers) : false,
        }))
      }
      return result
    },
    'svn.log': (payload) => {
      const { cwd } = cwdOf(payload)
      const record = payload as { limit?: unknown; path?: unknown } | null
      const limit = typeof record?.limit === 'number' && record.limit > 0 ? record.limit : 30
      const path = optionalString(payload, 'path')
      return svn.log(cwd, { limit, path })
    },
    'svn.diff': async (payload) => {
      const { cwd } = cwdOf(payload)
      const record = payload as { path?: unknown; rev1?: unknown; rev2?: unknown } | null
      const diff = await svn.diff(cwd, {
        path: optionalString(payload, 'path'),
        rev1: typeof record?.rev1 === 'string' && record.rev1 !== '' ? record.rev1 : undefined,
        rev2: typeof record?.rev2 === 'string' && record.rev2 !== '' ? record.rev2 : undefined,
      })
      return { diff }
    },
    'svn.commit': async (payload) => {
      const { cwd } = cwdOf(payload)
      const message = requireString(payload, 'message')
      const targets = pathsOf(payload)
      return svn.commit(cwd, message, targets)
    },
    'svn.update': async (payload) => {
      const { cwd } = cwdOf(payload)
      const targets = pathsOf(payload)
      return { output: await svn.update(cwd, targets) }
    },
    'svn.revert': async (payload) => {
      const { cwd } = cwdOf(payload)
      const targets = pathsOf(payload)
      if (targets.length === 0) throw new SvnError('bad-request', '"paths" is required for revert')
      return { output: await svn.revert(cwd, targets) }
    },
    'svn.resolve': async (payload) => {
      const { cwd } = cwdOf(payload)
      const target = requireString(payload, 'target')
      const accept = requireString(payload, 'accept')
      const record = payload as { recursive?: unknown } | null
      return { output: await svn.resolve(cwd, target, accept, record?.recursive === true) }
    },
    'svn.add': async (payload) => {
      const { cwd } = cwdOf(payload)
      const targets = pathsOf(payload)
      if (targets.length === 0) throw new SvnError('bad-request', '"paths" is required for add')
      return { output: await svn.add(cwd, targets) }
    },
    'svn.remove': async (payload) => {
      const { cwd } = cwdOf(payload)
      const targets = pathsOf(payload)
      if (targets.length === 0) throw new SvnError('bad-request', '"paths" is required for remove')
      return { output: await svn.remove(cwd, targets) }
    },
    'svn.move': async (payload) => {
      const { cwd } = cwdOf(payload)
      const from = requireString(payload, 'from')
      const to = requireString(payload, 'to')
      return { output: await svn.move(cwd, from, to) }
    },
    'svn.switch': async (payload) => {
      const { cwd } = cwdOf(payload)
      const url = requireString(payload, 'url')
      const target = optionalString(payload, 'target')
      return { output: await svn.switchTo(cwd, url, target) }
    },
    'svn.merge': async (payload) => {
      const { cwd } = cwdOf(payload)
      const url = requireString(payload, 'url')
      const record = payload as { rev1?: unknown; rev2?: unknown } | null
      const rev1 = typeof record?.rev1 === 'string' && record.rev1 !== '' ? record.rev1 : undefined
      const rev2 = typeof record?.rev2 === 'string' && record.rev2 !== '' ? record.rev2 : undefined
      return { output: await svn.merge(cwd, url, rev1, rev2) }
    },
    'svn.copy-url': async (payload) => {
      const { cwd } = cwdOf(payload)
      const fromUrl = requireString(payload, 'fromUrl')
      const toUrl = requireString(payload, 'toUrl')
      const message = requireString(payload, 'message')
      return { output: await svn.copyUrl(cwd, fromUrl, toUrl, message) }
    },
    'svn.checkout': async (payload) => {
      const { cwd } = cwdOf(payload)
      const url = requireString(payload, 'url')
      const target = optionalString(payload, 'target')
      return { output: await svn.checkout(cwd, url, target) }
    },
    'svn.list': async (payload) => {
      const { cwd } = cwdOf(payload)
      const url = requireString(payload, 'url')
      const revision = optionalString(payload, 'revision')
      return { entries: await svn.list(cwd, url, revision) }
    },
    'svn.blame': async (payload) => {
      const { cwd } = cwdOf(payload)
      const path = requireString(payload, 'path')
      return { lines: await svn.blame(cwd, path) }
    },
    'svn.cleanup': async (payload) => {
      const { cwd } = cwdOf(payload)
      const record = payload as { vacuum?: unknown } | null
      return { output: await svn.cleanup(cwd, record?.vacuum === true) }
    },
    'svn.shelve': async (payload) => {
      const { cwd } = cwdOf(payload)
      const name = requireString(payload, 'name')
      const targets = pathsOf(payload)
      const record = payload as { keep?: unknown } | null
      return { output: await svn.shelve(cwd, name, targets, record?.keep === true) }
    },
    'svn.unshelve': async (payload) => {
      const { cwd } = cwdOf(payload)
      const name = requireString(payload, 'name')
      const record = payload as { drop?: unknown } | null
      return { output: await svn.unshelve(cwd, name, record?.drop === true) }
    },
    'svn.shelve-delete': async (payload) => {
      const { cwd } = cwdOf(payload)
      const name = requireString(payload, 'name')
      return { output: await svn.shelveDelete(cwd, name) }
    },
    'svn.shelve-list': async (payload) => {
      const { cwd } = cwdOf(payload)
      return { shelves: await svn.shelveList(cwd) }
    },
    'svn.propget': async (payload) => {
      const { cwd } = cwdOf(payload)
      const prop = requireString(payload, 'prop')
      const target = requireString(payload, 'target')
      return { value: await svn.propget(cwd, prop, target) }
    },
    'svn.propset': async (payload) => {
      const { cwd } = cwdOf(payload)
      const prop = requireString(payload, 'prop')
      const value = requireString(payload, 'value')
      const target = requireString(payload, 'target')
      return { output: await svn.propset(cwd, prop, value, target) }
    },
    'svn.proplist': async (payload) => {
      const { cwd } = cwdOf(payload)
      const target = requireString(payload, 'target')
      return { props: await svn.proplist(cwd, target) }
    },
    'svn.changelist': async (payload) => {
      const { cwd } = cwdOf(payload)
      const record = payload as { name?: unknown; target?: unknown; remove?: unknown } | null
      const name = typeof record?.name === 'string' && record.name !== '' ? record.name : undefined
      const target = typeof record?.target === 'string' && record.target !== '' ? record.target : undefined
      if (name === undefined && target === undefined) {
        return { groups: await svn.changelists(cwd) }
      }
      if (name === undefined || target === undefined) {
        throw new SvnError('bad-request', 'both "name" and "target" are required to assign a changelist')
      }
      return { output: await svn.changelist(cwd, name, target, record?.remove === true) }
    },
    'svn.lock': async (payload) => {
      const { cwd } = cwdOf(payload)
      const targets = pathsOf(payload)
      if (targets.length === 0) throw new SvnError('bad-request', '"paths" is required for lock')
      const message = optionalString(payload, 'message')
      return { output: await svn.lock(cwd, targets, message) }
    },
    'svn.unlock': async (payload) => {
      const { cwd } = cwdOf(payload)
      const targets = pathsOf(payload)
      if (targets.length === 0) throw new SvnError('bad-request', '"paths" is required for unlock')
      const record = payload as { force?: unknown } | null
      return { output: await svn.unlock(cwd, targets, record?.force === true) }
    },
  }
}

/** ── Model-facing tools ────────────────────────────────────────────────── */

/** Extract the calling agent or throw the canonical "no agent" error. */
function requireAgent(agent: { session: { id: string } } | undefined): { session: { id: string } } {
  if (agent === undefined) {
    throw new Error('svn tools require an initiating agent')
  }
  return agent
}

/** Resolve the calling agent's session id. */
function sessionIdOf(exec: { agent?: { session: { id: string } } }): string {
  return requireAgent(exec.agent).session.id
}

/** Pure text projection helper. */
function textRender<T>(fn: (value: T) => string): (_args: unknown, value: unknown) => ContentBlock[] {
  return (_args, value) => [{ type: 'text', text: fn(value as T) }]
}

/** Register the svn_* model-facing tools. */
export function registerTools(ctx: SvnHostContext, resolveCwd: (sessionId: string) => string): () => void {
  const disposers: Array<() => void> = []
  const register = (tool: unknown): void => {
    disposers.push(ctx.tools.register(tool))
  }
  const cwdOf = (exec: { agent?: { session: { id: string } } }): string => resolveCwd(sessionIdOf(exec))

  register(defineTool({
    name: 'svn_status',
    description:
      'Show the Subversion working-copy status of the current session directory: '
      + 'modified / added / deleted / unversioned / conflicted files, the repository URL and current revision. '
      + 'Output entries are paths relative to the session working directory.',
    parameters: {
      showIgnored: {
        type: 'boolean',
        description: 'Whether to include ignored files in the listing (default false).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          isWorkCopy: { type: 'boolean', required: true },
          url: { type: 'string' },
          revision: { type: 'number' },
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                item: { type: 'string', required: true },
                props: { type: 'string' },
                revision: { type: 'number' },
              },
            },
          },
        },
      },
      render: textRender((v: svn.SvnStatusResult) =>
        v.isWorkCopy
          ? `SVN ${v.url ?? ''} @r${v.revision ?? '?'} — ${v.entries.length} entries:\n`
            + v.entries.map(e => `${e.item}  ${e.path}`).join('\n')
          : 'Not a Subversion working copy.',
      ),
    },
    execute: async (args: { showIgnored?: boolean }, exec) => {
      exec.signal.throwIfAborted()
      return svn.status(cwdOf(exec), { showIgnored: args.showIgnored === true })
    },
  }))

  register(defineTool({
    name: 'svn_log',
    description:
      'Show the Subversion commit log of the session working copy (newest first): '
      + 'revision, author, date, message and changed paths for each entry.',
    parameters: {
      limit: {
        type: 'number',
        description: 'Maximum number of log entries to return (default 30).',
      },
      path: {
        type: 'string',
        description: 'Restrict the log to this path (relative to the session working directory).',
      },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            revision: { type: 'string', required: true },
            author: { type: 'string' },
            date: { type: 'string' },
            message: { type: 'string' },
            changedPaths: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  action: { type: 'string' },
                  path: { type: 'string' },
                  kind: { type: 'string' },
                },
              },
            },
          },
        },
      },
      render: textRender((v: svn.SvnLogEntry[]) =>
        v.length === 0 ? 'No commits found.' : v.map(e =>
          `r${e.revision}  ${e.author}  ${e.date}\n  ${e.message.replace(/\n/g, '\n  ')}`,
        ).join('\n'),
      ),
    },
    execute: async (args: { limit?: number; path?: string }, exec) => {
      exec.signal.throwIfAborted()
      return svn.log(cwdOf(exec), { limit: args.limit ?? 30, path: args.path })
    },
  }))

  register(defineTool({
    name: 'svn_diff',
    description:
      'Show the Subversion diff of the session working copy: uncommitted changes vs BASE by default, '
      + 'or between two revisions when rev1 and rev2 are given. Optionally restrict to one path. '
      + 'Returns unified-diff text.',
    parameters: {
      path: {
        type: 'string',
        description: 'Restrict the diff to this path (relative to the session working directory).',
      },
      rev1: {
        type: 'string',
        description: 'First revision for a revision-to-revision diff (e.g. "100").',
      },
      rev2: {
        type: 'string',
        description: 'Second revision for a revision-to-revision diff (e.g. "120").',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          diff: { type: 'string', required: true, description: 'Unified diff text.' },
        },
      },
      render: textRender((v: { diff: string }) => v.diff || '(no differences)'),
    },
    execute: async (args: { path?: string; rev1?: string; rev2?: string }, exec) => {
      exec.signal.throwIfAborted()
      const diff = await svn.diff(cwdOf(exec), { path: args.path, rev1: args.rev1, rev2: args.rev2 })
      return { diff }
    },
  }))

  register(defineTool({
    name: 'svn_commit',
    description:
      'Commit pending Subversion changes of the session working copy with a message. '
      + 'If "paths" is empty, commits all modified/add/deleted files (new files are NOT auto-added by svn — use svn_add first).',
    parameters: {
      message: { type: 'string', required: true, description: 'Commit message.' },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional subset of paths to commit (relative to the session working directory).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          revision: { type: 'string', required: true, description: 'The new repository revision.' },
        },
      },
      render: textRender((v: { revision: string }) => `Committed as revision ${v.revision}.`),
    },
    execute: async (args: { message: string; paths?: string[] }, exec) => {
      exec.signal.throwIfAborted()
      return svn.commit(cwdOf(exec), args.message, args.paths ?? [])
    },
  }))

  register(defineTool({
    name: 'svn_update',
    description: 'Update the Subversion working copy of the session to the latest repository revision.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          output: { type: 'string', required: true, description: 'svn update output.' },
        },
      },
      render: textRender((v: { output: string }) => v.output),
    },
    execute: async (_args: Record<string, never>, exec) => {
      exec.signal.throwIfAborted()
      return { output: await svn.update(cwdOf(exec)) }
    },
  }))

  register(defineTool({
    name: 'svn_revert',
    description: 'Revert local (uncommitted) changes of the given paths in the Subversion working copy.',
    parameters: {
      paths: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'Paths to revert (relative to the session working directory).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          output: { type: 'string', required: true },
        },
      },
      render: textRender((v: { output: string }) => v.output),
    },
    execute: async (args: { paths: string[] }, exec) => {
      exec.signal.throwIfAborted()
      return { output: await svn.revert(cwdOf(exec), args.paths) }
    },
  }))

  register(defineTool({
    name: 'svn_add',
    description: 'Schedule files/directories for addition in the Subversion working copy (svn add, with parents).',
    parameters: {
      paths: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'Paths to add (relative to the session working directory).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          output: { type: 'string', required: true },
        },
      },
      render: textRender((v: { output: string }) => v.output),
    },
    execute: async (args: { paths: string[] }, exec) => {
      exec.signal.throwIfAborted()
      return { output: await svn.add(cwdOf(exec), args.paths) }
    },
  }))

  register(defineTool({
    name: 'svn_shelve',
    description:
      'Shelve (stash) pending local changes in the Subversion working copy under a name '
      + '(svn shelve --keep-local, so the changes are also left in the working copy). '
      + 'List with svn_shelve_list, restore with svn_unshelve.',
    parameters: {
      name: { type: 'string', required: true, description: 'Shelve name.' },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional subset of paths to shelve.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          output: { type: 'string', required: true },
        },
      },
      render: textRender((v: { output: string }) => v.output),
    },
    execute: async (args: { name: string; paths?: string[] }, exec) => {
      exec.signal.throwIfAborted()
      return { output: await svn.shelve(cwdOf(exec), args.name, args.paths ?? []) }
    },
  }))

  register(defineTool({
    name: 'svn_unshelve',
    description: 'Restore a shelved change set into the Subversion working copy (svn unshelve).',
    parameters: {
      name: { type: 'string', required: true, description: 'Shelve name to restore.' },
      drop: {
        type: 'boolean',
        description: 'Drop the shelve after restoring (default false).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          output: { type: 'string', required: true },
        },
      },
      render: textRender((v: { output: string }) => v.output),
    },
    execute: async (args: { name: string; drop?: boolean }, exec) => {
      exec.signal.throwIfAborted()
      return { output: await svn.unshelve(cwdOf(exec), args.name, args.drop === true) }
    },
  }))

  register(defineTool({
    name: 'svn_shelve_list',
    description: 'List shelved change sets of the session Subversion working copy.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          shelves: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                keep: { type: 'boolean' },
                version: { type: 'number' },
                summary: { type: 'string' },
              },
            },
          },
        },
      },
      render: textRender((v: { shelves: svn.SvnShelveEntry[] }) =>
        v.shelves.length === 0 ? '(no shelves)' : v.shelves.map(s => `${s.name}${s.keep ? ' (keep)' : ''} — ${s.summary}`).join('\n'),
      ),
    },
    execute: async (_args: Record<string, never>, exec) => {
      exec.signal.throwIfAborted()
      return { shelves: await svn.shelveList(cwdOf(exec)) }
    },
  }))

  register(defineTool({
    name: 'svn_blame',
    description: 'Annotate a file line-by-line with the revision and author that last changed each line (svn blame).',
    parameters: {
      path: { type: 'string', required: true, description: 'File path (relative to the session working directory).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          lines: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                lineNumber: { type: 'number' },
                revision: { type: 'string' },
                author: { type: 'string' },
                text: { type: 'string' },
              },
            },
          },
        },
      },
      render: textRender((v: { lines: svn.SvnBlameLine[] }) =>
        v.lines.map(l => `${l.revision.padStart(6, ' ')} ${(l.author ?? '').padEnd(12, ' ')} ${l.text}`).join('\n'),
      ),
    },
    execute: async (args: { path: string }, exec) => {
      exec.signal.throwIfAborted()
      return { lines: await svn.blame(cwdOf(exec), args.path) }
    },
  }))

  return () => {
    for (const d of disposers) {
      try { d() } catch { /* already disposed */ }
    }
  }
}

/**
 * Plugin body: mount the fenced /svn/api routes and the svn_* tools.
 */
export function apply(ctx: SvnHostContext): void {
  const fence = (req: IncomingMessage): boolean => isTrustedApiRequest(req, ctx.webRuntime.trustedHosts)
  const api = buildApi(ctx)

  // ── JSON API ────────────────────────────────────────────────────────────
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/svn/api',
    handler: async (req, res) => {
      if (!fence(req)) {
        writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
        return
      }
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      const method = pathname.startsWith('/svn/api/') ? pathname.slice('/svn/api/'.length) : undefined
      if (method === undefined || method.includes('/')) {
        writeError(res, new SvnError('not-found', 'unknown svn API method', 404))
        return
      }
      try {
        const payload = await readJsonBody(req)
        const handler = api[method]
        if (handler === undefined) {
          throw new SvnError('not-found', `unknown svn API method "${method}"`, 404)
        }
        writeOk(res, await handler(payload))
      } catch (error) {
        writeError(res, error)
      }
    },
  }), 'dsh-svn-plugin: /svn/api routes')

  // ── Model-facing tools ──────────────────────────────────────────────────
  ctx.effect(() => registerTools(ctx, (sessionId) => sessionCwdOf(ctx, sessionId)), 'dsh-svn-plugin: svn tools')
}
