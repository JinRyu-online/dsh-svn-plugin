/**
 * Typed fetch wrapper over the /svn JSON API. Every call posts to
 * `/svn/api/<method>` with the sessionId and — when known — the session's
 * cwd from the client's own list summary. Failures surface as
 * {@link SvnApiError} with the wire code.
 */
import type {
  SvnBlameLine,
  SvnInfoResult,
  SvnListEntry,
  SvnLogEntry,
  SvnShelveEntry,
  SvnStatusResult,
} from './svn-types.ts'

/** One wire failure. */
export class SvnApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** One request's session scope: the conversation id plus its cwd when known. */
export interface SessionScope {
  sessionId: string
  /** The session's working directory from the client list summary (optional). */
  cwd?: string
}

/** Fold a scope into a JSON payload ({cwd} only when present). */
function scopePayload(scope: SessionScope, extra: Record<string, unknown>): Record<string, unknown> {
  return { sessionId: scope.sessionId, ...(scope.cwd !== undefined && scope.cwd !== '' ? { cwd: scope.cwd } : {}), ...extra }
}

async function call<T>(method: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/svn/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (error) {
    // Preserve abort semantics so callers can ignore cancelled requests.
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new SvnApiError('network', error instanceof Error ? error.message : String(error))
  }
  const parsed: { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } } | null
    = await response.json().catch(() => null)
  if (!response.ok || parsed === null || parsed.ok !== true || parsed.value === undefined) {
    throw new SvnApiError(
      parsed?.error?.code ?? 'http',
      parsed?.error?.message ?? `HTTP ${response.status}`,
    )
  }
  return parsed.value as T
}

/** The svn API surface (session scope threaded through every call). */
export const api = {
  info: (scope: SessionScope, signal?: AbortSignal) =>
    call<SvnInfoResult>('svn.info', scopePayload(scope, {}), signal),
  capabilities: (signal?: AbortSignal) =>
    call<{ shelve: boolean }>('svn.capabilities', {}, signal),
  status: (scope: SessionScope, showIgnored = false, signal?: AbortSignal) =>
    call<SvnStatusResult>('svn.status', scopePayload(scope, { showIgnored }), signal),
  log: (scope: SessionScope, limit = 30, path?: string, signal?: AbortSignal) =>
    call<SvnLogEntry[]>('svn.log', scopePayload(scope, { limit, ...(path !== undefined && path !== '' ? { path } : {}) }), signal),
  diff: (scope: SessionScope, path?: string, rev1?: string, rev2?: string, signal?: AbortSignal) =>
    call<{ diff: string }>('svn.diff', scopePayload(scope, {
      ...(path !== undefined && path !== '' ? { path } : {}),
      ...(rev1 !== undefined ? { rev1 } : {}),
      ...(rev2 !== undefined ? { rev2 } : {}),
    }), signal),
  commit: (scope: SessionScope, message: string, paths: string[]) =>
    call<{ revision: string }>('svn.commit', scopePayload(scope, { message, paths })),
  update: (scope: SessionScope, paths: string[] = []) =>
    call<{ output: string }>('svn.update', scopePayload(scope, { paths })),
  revert: (scope: SessionScope, paths: string[]) =>
    call<{ output: string }>('svn.revert', scopePayload(scope, { paths })),
  resolve: (scope: SessionScope, target: string, accept: string, recursive = false) =>
    call<{ output: string }>('svn.resolve', scopePayload(scope, { target, accept, recursive })),
  add: (scope: SessionScope, paths: string[]) =>
    call<{ output: string }>('svn.add', scopePayload(scope, { paths })),
  remove: (scope: SessionScope, paths: string[]) =>
    call<{ output: string }>('svn.remove', scopePayload(scope, { paths })),
  move: (scope: SessionScope, from: string, to: string) =>
    call<{ output: string }>('svn.move', scopePayload(scope, { from, to })),
  switchTo: (scope: SessionScope, url: string, target?: string) =>
    call<{ output: string }>('svn.switch', scopePayload(scope, { url, ...(target !== undefined && target !== '' ? { target } : {}) })),
  merge: (scope: SessionScope, url: string, rev1?: string, rev2?: string) =>
    call<{ output: string }>('svn.merge', scopePayload(scope, { url, ...(rev1 !== undefined ? { rev1 } : {}), ...(rev2 !== undefined ? { rev2 } : {}) })),
  copyUrl: (scope: SessionScope, fromUrl: string, toUrl: string, message: string) =>
    call<{ output: string }>('svn.copy-url', scopePayload(scope, { fromUrl, toUrl, message })),
  checkout: (scope: SessionScope, url: string, target?: string) =>
    call<{ output: string }>('svn.checkout', scopePayload(scope, { url, ...(target !== undefined && target !== '' ? { target } : {}) })),
  list: (scope: SessionScope, url: string, revision?: string, signal?: AbortSignal) =>
    call<{ entries: SvnListEntry[] }>('svn.list', scopePayload(scope, { url, ...(revision !== undefined && revision !== '' ? { revision } : {}) }), signal),
  blame: (scope: SessionScope, path: string, signal?: AbortSignal) =>
    call<{ lines: SvnBlameLine[] }>('svn.blame', scopePayload(scope, { path }), signal),
  cleanup: (scope: SessionScope, vacuum = false) =>
    call<{ output: string }>('svn.cleanup', scopePayload(scope, { vacuum })),
  shelve: (scope: SessionScope, name: string, paths: string[], keep = false) =>
    call<{ output: string }>('svn.shelve', scopePayload(scope, { name, paths, keep })),
  unshelve: (scope: SessionScope, name: string, drop = false) =>
    call<{ output: string }>('svn.unshelve', scopePayload(scope, { name, drop })),
  shelveDelete: (scope: SessionScope, name: string) =>
    call<{ output: string }>('svn.shelve-delete', scopePayload(scope, { name })),
  shelveList: (scope: SessionScope, signal?: AbortSignal) =>
    call<{ shelves: SvnShelveEntry[] }>('svn.shelve-list', scopePayload(scope, {}), signal),
  propget: (scope: SessionScope, prop: string, target: string) =>
    call<{ value: string }>('svn.propget', scopePayload(scope, { prop, target })),
  propset: (scope: SessionScope, prop: string, value: string, target: string) =>
    call<{ output: string }>('svn.propset', scopePayload(scope, { prop, value, target })),
  proplist: (scope: SessionScope, target: string) =>
    call<{ props: Array<{ name: string; value: string }> }>('svn.proplist', scopePayload(scope, { target })),
  changelist: (scope: SessionScope, name?: string, target?: string, remove = false) =>
    call<{ output: string } | { groups: Array<{ name: string; paths: string[] }> }>(
      'svn.changelist',
      scopePayload(scope, { ...(name !== undefined ? { name } : {}), ...(target !== undefined ? { target } : {}), remove }),
    ),
  lock: (scope: SessionScope, paths: string[], message?: string) =>
    call<{ output: string }>('svn.lock', scopePayload(scope, { paths, ...(message !== undefined && message !== '' ? { message } : {}) })),
  unlock: (scope: SessionScope, paths: string[], force = false) =>
    call<{ output: string }>('svn.unlock', scopePayload(scope, { paths, force })),
}
