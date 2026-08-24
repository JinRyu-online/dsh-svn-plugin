/** BlameView: svn blame — line-by-line revision/author annotation. */
import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import type { SessionScope } from './api.ts'
import { api } from './api.ts'
import type { SvnBlameLine } from './svn-types.ts'
import { Scroll, StatusLine } from './ui.tsx'

export interface BlameViewProps {
  scope: SessionScope
  t: (key: string) => string
  path: string
}

export function BlameView(props: BlameViewProps): ReactNode {
  const { scope, path } = props
  const [lines, setLines] = useState<SvnBlameLine[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLines(null)
    setError(null)
    api.blame(scope, path)
      .then(r => { if (alive) setLines(r.lines) })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [scope.sessionId, scope.cwd, path])

  if (error !== null) return h(StatusLine, { text: error, error: true })
  if (lines === null) return h(StatusLine, { text: props.t('loading') })

  return h(Scroll, { flex: true },
    h('table', { style: { width: '100%', borderCollapse: 'collapse', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11px', lineHeight: '1.5' } },
      h('tbody', null,
        lines.map(l => h('tr', { key: l.lineNumber, style: { verticalAlign: 'top' } },
          h('td', { style: { padding: '0 6px', textAlign: 'right', color: 'var(--dsw-alias-label-tertiary)', userSelect: 'none', whiteSpace: 'nowrap' } }, l.lineNumber),
          h('td', { style: { padding: '0 6px', color: 'var(--dsw-alias-brand-primary)', whiteSpace: 'nowrap' } }, `r${l.revision}`),
          h('td', { style: { padding: '0 6px', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' } }, l.author),
          h('td', { style: { padding: '0 6px', color: 'var(--dsw-alias-label-primary)', whiteSpace: 'pre' } }, l.text),
        )),
      ),
    ),
  )
}
