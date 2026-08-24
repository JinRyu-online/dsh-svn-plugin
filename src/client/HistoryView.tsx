/** HistoryView: svn log in the Git-panel history-row style — line 1 is the
 *  revision + subject, line 2 the author · date · files. Selecting a row
 *  shows its message and changed paths; clicking a changed path expands that
 *  single file's diff (rev N-1 → N) right there, and clicking again collapses
 *  it. */
import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import type { SessionScope } from './api.ts'
import { api } from './api.ts'
import type { SvnLogEntry } from './svn-types.ts'
import { Btn, Field, Scroll, StatusLine } from './ui.tsx'
import { parseUnifiedDiff } from './DiffView.tsx'

export interface HistoryViewProps {
  scope: SessionScope
  t: (key: string) => string
  visible: boolean
}

const ACTION_LABEL: Record<string, string> = {
  M: 'M', A: 'A', D: 'D', R: 'R', G: 'G', C: 'C',
}

export function HistoryView(props: HistoryViewProps): ReactNode {
  const { scope, t } = props
  const [entries, setEntries] = useState<SvnLogEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notWorkCopy, setNotWorkCopy] = useState(false)
  const [limit, setLimit] = useState('30')
  const [pathFilter, setPathFilter] = useState('')
  const [selected, setSelected] = useState<SvnLogEntry | null>(null)
  /** The changed-path whose per-file diff is expanded (null = none). */
  const [fileDiffPath, setFileDiffPath] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const lim = Number(limit)
      const rows = await api.log(scope, Number.isFinite(lim) && lim > 0 ? lim : 30, pathFilter)
      setNotWorkCopy(false)
      setEntries(rows)
      setFileDiffPath(null)
      setSelected(prev => prev !== null && rows.some(r => r.revision === prev.revision) ? prev : (rows[0] ?? null))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // svn: E155007 … is not a working copy → clear the list instead of
      // showing the raw error (the session's cwd is not a WC).
      if (/E155007|is not a working copy/i.test(msg)) {
        setNotWorkCopy(true)
        setEntries([])
        setSelected(null)
        setFileDiffPath(null)
        setError(null)
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [scope.sessionId, scope.cwd])

  return h('div', {
    style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' },
  },
    // toolbar (fixed)
    h('div', { style: { flex: 'none', padding: '0 4px 4px', display: 'flex', gap: '6px', alignItems: 'flex-end' } },
      h('div', { style: { flex: '0 0 70px' } },
        h(Field, { label: t('revision'), value: limit, onChange: setLimit }),
      ),
      h('div', { style: { flex: '1 1 auto' } },
        h(Field, { label: t('path'), value: pathFilter, onChange: setPathFilter, placeholder: t('allFiles') }),
      ),
      h(Btn, { onClick: () => void load(), disabled: loading }, t('refresh')),
    ),
    // log list (scrolls)
    h(Scroll, { flex: true },
      h('div', { style: { display: 'flex', flexDirection: 'column' } },
        error !== null && h(StatusLine, { text: error, error: true }),
        loading && entries === null ? h(StatusLine, { text: t('loading') })
          : notWorkCopy ? h(StatusLine, { text: t('notWorkCopyHistory') })
            : entries === null || entries.length === 0 ? h(StatusLine, { text: t('noHistory') })
              : entries.map(e => h(LogRow, {
                key: e.revision,
                entry: e,
                t,
                active: selected?.revision === e.revision,
                onSelect: () => { setSelected(e); setFileDiffPath(null) },
              })),
      ),
    ),
    // selected commit detail — pinned to the bottom, always visible
    selected !== null && h('div', {
      style: {
        flex: '0 0 auto', maxHeight: '45%', minHeight: '0', display: 'flex', flexDirection: 'column',
        borderTop: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-base)',
        padding: '6px 8px 8px',
      },
    },
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px', flex: 'none' } },
        h('span', { style: { font: 'var(--dsw-font-xxs-strong-12)', color: 'var(--dsw-alias-label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          `r${selected.revision} · ${selected.author} · ${selected.date.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '')}`),
      ),
      h('div', { style: { flex: '1 1 auto', minHeight: '0', overflow: 'auto' } },
        h('div', { style: { font: 'var(--dsw-font-xxs-12)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: '6px', color: 'var(--dsw-alias-label-primary)' } }, selected.message || t('empty')),
        selected.changedPaths.length > 0 && h('div', { style: { font: 'var(--dsw-font-xxxs-11)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', marginBottom: '6px' } },
          selected.changedPaths.map(cp => {
            const expanded = fileDiffPath === cp.path
            const rev1 = Number(selected.revision) - 1
            return h('div', { key: cp.path, style: { marginBottom: expanded ? '6px' : '0' } },
              h('button', {
                type: 'button',
                style: {
                  display: 'inline-flex', alignItems: 'center', gap: '4px', maxWidth: '100%',
                  border: 'none', background: 'transparent', padding: '0', cursor: 'pointer',
                  font: 'inherit', textAlign: 'left',
                  color: expanded ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
                },
                title: expanded ? t('collapse') : `${t('diff')}: ${cp.path}`,
                onClick: () => setFileDiffPath(expanded ? null : cp.path),
              },
                h('span', { style: { display: 'inline-block', width: '18px', fontWeight: 700, flex: 'none', color: ACTION_LABEL[cp.action] === 'D' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-success-primary)' } }, ACTION_LABEL[cp.action] ?? cp.action),
                h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 'none', minWidth: '0', maxWidth: 'calc(100% - 40px)' } }, cp.path),
                h('span', { style: { flex: 'none', fontSize: '8px', color: 'var(--dsw-alias-label-tertiary)' } }, expanded ? '▾' : '▸'),
              ),
              expanded && (rev1 < 1
                ? h('div', { style: { marginTop: '2px', font: 'var(--dsw-font-xxs-12)', color: 'var(--dsw-alias-label-tertiary)' } }, t('initialRevision'))
                : h(FileDiff, {
                  scope, t,
                  path: cp.path,
                  rev1: String(rev1),
                  rev2: selected.revision,
                })),
            )
          }),
        ),
      ),
    ),
  )
}

/** Per-file diff between rev1 and rev2 (used by the changed-path list). */
function FileDiff(props: {
  scope: SessionScope
  t: (key: string) => string
  path: string
  rev1: string
  rev2: string
}): ReactNode {
  const { scope, t, path, rev1, rev2 } = props
  const [diff, setDiff] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setDiff(null)
    setError(null)
    api.diff(scope, path, rev1, rev2)
      .then(r => { if (alive) setDiff(r.diff) })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [scope.sessionId, scope.cwd, path, rev1, rev2])
  if (error !== null) return h('div', { style: { marginTop: '2px' } },
    h(StatusLine, { text: error, error: true }))
  if (diff === null) return h('div', { style: { marginTop: '2px' } },
    h(StatusLine, { text: t('loading') }))
  return h('div', { style: { marginTop: '2px' } },
    h(ColoredDiff, { text: diff || t('empty'), t }))
}

/** Colored unified-diff rendering (red/green background lines, same style as
 *  the main status-page diff). */
function ColoredDiff(props: { text: string; t: (key: string) => string }): ReactNode {
  const rows = parseUnifiedDiff(props.text)
  return h(Scroll, { },
    h('div', { style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11px', lineHeight: '1.5' } },
      rows.length === 0 ? h(StatusLine, { text: props.t('empty') })
        : rows.map((r, i) => h('div', {
          key: i,
          style: {
            whiteSpace: 'pre', wordBreak: 'break-all',
            background: r.kind === 'add' ? 'rgba(77,158,77,.16)'
              : r.kind === 'del' ? 'rgba(217,83,79,.16)'
                : r.kind === 'hunk' ? 'rgba(77,124,254,.14)'
                  : 'transparent',
            color: r.kind === 'add' ? 'var(--dsw-alias-state-success-primary)'
              : r.kind === 'del' ? 'var(--dsw-alias-state-error-primary)'
                : r.kind === 'hunk' ? 'var(--dsw-alias-brand-primary)'
                  : r.kind === 'meta' ? 'var(--dsw-alias-label-secondary)'
                    : 'var(--dsw-alias-label-primary)',
          },
        }, r.text)),
    ),
  )
}

function LogRow(props: {
  entry: SvnLogEntry
  t: (key: string) => string
  active: boolean
  onSelect: () => void
}): ReactNode {
  const e = props.entry
  const date = e.date.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '')
  return h('div', {
    style: {
      display: 'flex', flexDirection: 'column', gap: '2px',
      padding: '5px 12px', cursor: 'pointer', borderRadius: '8px',
      background: props.active ? 'var(--dsw-alias-interactive-bg-active)' : 'transparent',
    },
    onClick: props.onSelect,
  },
    h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', minWidth: '0' } },
      h('span', { style: { flex: 'none', font: 'var(--dsw-font-markdown-code-block-small)', color: 'var(--dsw-alias-label-tertiary)' } }, `r${e.revision}`),
      h('span', { style: { flex: '1', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: 'var(--dsw-font-s-14)', color: 'var(--dsw-alias-label-primary)' } },
        e.message.split('\n')[0] || props.t('empty')),
    ),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: '0', flexWrap: 'wrap' } },
      h('span', { style: { font: 'var(--dsw-font-xxxs-11)', color: 'var(--dsw-alias-label-tertiary)' } },
        `${e.author} · ${date} · ${e.changedPaths.length} files`),
    ),
  )
}
