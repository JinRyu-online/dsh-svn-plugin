/** ShelveView: svn shelve / unshelve / shelve-delete — IDEA-style stash. */
import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import type { SessionScope } from './api.ts'
import { api } from './api.ts'
import type { SvnShelveEntry } from './svn-types.ts'
import { Btn, Field, OutputBlock, Scroll, StatusLine } from './ui.tsx'

export interface ShelveViewProps {
  scope: SessionScope
  t: (key: string) => string
  onChanged: () => void
  visible: boolean
  shelveCapable?: boolean
}

export function ShelveView(props: ShelveViewProps): ReactNode {
  const { scope, t } = props
  const [shelves, setShelves] = useState<SvnShelveEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [output, setOutput] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.shelveList(scope)
      setShelves(r.shelves)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [scope.sessionId, scope.cwd])

  const act = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError(null)
    setOutput(null)
    try {
      const r = await fn()
      setOutput(typeof r === 'object' && r !== null && 'output' in r ? String((r as { output: unknown }).output) : JSON.stringify(r))
      await load()
      props.onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return h(Scroll, { flex: true },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
      props.shelveCapable === false && h(StatusLine, { text: t('shelveUnavailable'), error: true }),
      h('div', { style: { display: 'flex', gap: '6px', alignItems: 'flex-end' } },
        h('div', { style: { flex: '1 1 auto' } },
          h(Field, { label: t('shelveNamePlaceholder'), value: name, onChange: setName, placeholder: t('shelveNamePlaceholder') }),
        ),
        h(Btn, { onClick: () => void load(), disabled: loading }, t('refresh')),
      ),
      error !== null && h(StatusLine, { text: error, error: true }),
      loading && shelves === null ? h(StatusLine, { text: t('loading') })
        : shelves === null || shelves.length === 0 ? h(StatusLine, { text: t('noShelves') })
          : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            shelves.map(s => h('div', {
              key: s.name,
              style: {
                display: 'flex', alignItems: 'center', gap: '6px', padding: '6px',
                border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '6px',
              },
            },
              h('div', { style: { flex: '1 1 auto', minWidth: '0' } },
                h('div', { style: { fontSize: '12px', fontWeight: 600 } },
                  s.name, s.keep ? ' (keep)' : '', ` [v${s.version}]`),
                h('div', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, s.summary),
              ),
              h(Btn, { onClick: () => void act(t('unshelve'), () => api.unshelve(scope, s.name)), disabled: busy, title: t('unshelveSelected') }, t('unshelve')),
              h(Btn, { onClick: () => void act(t('dropShelve'), () => api.shelveDelete(scope, s.name)), disabled: busy, kind: 'danger', title: t('dropShelve') }, '🗑'),
            )),
          ),
      output !== null && h(OutputBlock, { text: output, maxHeight: 140 }),
    ),
  )
}
