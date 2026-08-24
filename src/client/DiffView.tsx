/** DiffView: unified diff rendering for one path (work-copy vs BASE by
 *  default, or a revision range). */
import { createElement as h, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { SessionScope } from './api.ts'
import { api } from './api.ts'
import { Btn, Field, Scroll, StatusLine } from './ui.tsx'

export interface DiffViewProps {
  scope: SessionScope
  t: (key: string) => string
  path: string
  /** Revision range mode instead of BASE comparison. */
  rev1?: string
  rev2?: string
}

/** Parse unified diff text into line records for colored rendering. */
export function parseUnifiedDiff(text: string): Array<{ kind: 'hunk' | 'add' | 'del' | 'ctx' | 'meta'; text: string }> {
  const lines = text.split('\n')
  const out: Array<{ kind: 'hunk' | 'add' | 'del' | 'ctx' | 'meta'; text: string }> = []
  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line.startsWith('@@')) {
      out.push({ kind: 'hunk', text: line })
    } else if (line.startsWith('+')) {
      out.push({ kind: 'add', text: line })
    } else if (line.startsWith('-')) {
      out.push({ kind: 'del', text: line })
    } else if (line.startsWith('Index:') || line.startsWith('===') || line.startsWith('---') || line.startsWith('+++')) {
      out.push({ kind: 'meta', text: line })
    } else {
      out.push({ kind: 'ctx', text: line })
    }
  }
  return out
}

export function DiffView(props: DiffViewProps): ReactNode {
  const { scope, t, path } = props
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revMode, setRevMode] = useState(props.rev1 !== undefined)
  const [rev1, setRev1] = useState(props.rev1 ?? '')
  const [rev2, setRev2] = useState(props.rev2 ?? '')

  useEffect(() => {
    let alive = true
    const controller = new AbortController()
    const debounce = setTimeout(() => {
      setText(null)
      setError(null)
      const r1 = revMode && rev1.trim() !== '' ? rev1.trim() : undefined
      const r2 = revMode && rev2.trim() !== '' ? rev2.trim() : undefined
      api.diff(scope, path, r1, r2, controller.signal)
        .then(r => { if (alive) setText(r.diff) })
        .catch((e: unknown) => {
          if (!alive || e instanceof DOMException && e.name === 'AbortError') return
          setError(e instanceof Error ? e.message : String(e))
        })
    }, 250)
    return () => { alive = false; controller.abort(); clearTimeout(debounce) }
  }, [scope.sessionId, scope.cwd, path, revMode, rev1, rev2])

  const rows = useMemo(() => text === null ? [] : parseUnifiedDiff(text), [text])

  return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', gap: '6px', minHeight: '0' } },
    h('div', { style: { display: 'flex', gap: '6px', alignItems: 'flex-end', flexWrap: 'wrap' } },
      h(Btn, { onClick: () => setRevMode(v => !v), title: t('compareRevisions') },
        revMode ? t('compareWithBase') : t('compareRevisions')),
      revMode && h('div', { style: { flex: '0 0 64px' } },
        h(Field, { label: t('rev1'), value: rev1, onChange: setRev1 })),
      revMode && h('div', { style: { flex: '0 0 64px' } },
        h(Field, { label: t('rev2'), value: rev2, onChange: setRev2 })),
    ),
    error !== null && h(StatusLine, { text: error, error: true }),
    text === null && error === null ? h(StatusLine, { text: t('loading') })
      : h(Scroll, { flex: true },
        text === null || text.trim() === ''
          ? h(StatusLine, { text: t('empty') })
          : h('div', { style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11px', lineHeight: '1.5' } },
            rows.map((r, i) => h('div', {
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
      ),
  )
}
