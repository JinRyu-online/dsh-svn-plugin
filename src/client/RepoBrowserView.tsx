/** RepoBrowserView: browse a repository URL (svn list), navigate dirs,
 *  and offer checkout of the current path. */
import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import type { SessionScope } from './api.ts'
import { api } from './api.ts'
import type { SvnInfoResult, SvnListEntry } from './svn-types.ts'
import { Btn, Field, Scroll, StatusLine } from './ui.tsx'

export interface RepoBrowserViewProps {
  scope: SessionScope
  t: (key: string) => string
  info: SvnInfoResult | null
  visible: boolean
}

export function RepoBrowserView(props: RepoBrowserViewProps): ReactNode {
  const { scope, t, info } = props
  const [base, setBase] = useState(info?.url ?? '')
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<SvnListEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [output, setOutput] = useState<string | null>(null)
  const [checkoutTarget, setCheckoutTarget] = useState('')

  const currentUrl = (): string => {
    const baseUrl = base.replace(/\/+$/, '')
    if (path === '') return baseUrl
    return `${baseUrl}/${path.replace(/^\/+/, '')}`
  }

  const load = async (url: string): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.list(scope, url)
      setEntries(r.entries)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setEntries(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (base.trim() === '') return
    void load(currentUrl())
  }, [base, path])

  const enter = (name: string, kind: string): void => {
    if (kind !== 'dir') return
    setPath(prev => prev === '' ? name : `${prev}/${name}`)
  }

  const doCheckout = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.checkout(scope, currentUrl(), checkoutTarget.trim() === '' ? undefined : checkoutTarget.trim())
      setOutput(r.output)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return h(Scroll, { flex: true },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
      h(Field, { label: t('url'), value: base, onChange: setBase, placeholder: t('repoUrlPlaceholder'), mono: true }),
      path !== '' && h('div', { style: { display: 'flex', gap: '4px', alignItems: 'center' } },
        h(Btn, { onClick: () => setPath('') }, 'root'),
        path.split('/').map((seg, i, arr) => h('span', { key: `${i}-${seg}`, style: { display: 'inline-flex', gap: '4px', alignItems: 'center' } },
          h(Btn, { onClick: () => setPath(arr.slice(0, i + 1).join('/')) }, seg),
          i < arr.length - 1 && ' / ',
        )),
      ),
      error !== null && h(StatusLine, { text: error, error: true }),
      loading && entries === null ? h(StatusLine, { text: t('loading') })
        : entries !== null && h('div', { style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '6px', overflow: 'hidden' } },
          h('div', { style: { padding: '4px 6px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', wordBreak: 'break-all' } }, currentUrl()),
          entries.length === 0 ? h('div', { style: { padding: '6px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, t('empty'))
            : entries.map(e => h('div', {
              key: e.name,
              style: {
                display: 'flex', gap: '8px', alignItems: 'center', padding: '3px 6px',
                cursor: e.kind === 'dir' ? 'pointer' : 'default',
                borderTop: '1px solid var(--dsw-alias-border-l1)',
              },
              onClick: () => enter(e.name, e.kind),
            },
              h('span', { style: { flex: '0 0 auto', color: e.kind === 'dir' ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)' } },
                e.kind === 'dir' ? '📁' : '📄'),
              h('span', { style: { flex: '1 1 auto', fontSize: '12px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } }, e.name),
              e.revision !== undefined && h('span', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-tertiary)' } }, `r${e.revision}`),
            )),
          ),
      h('div', { style: { display: 'flex', gap: '6px', alignItems: 'flex-end' } },
        h('div', { style: { flex: '1 1 auto' } },
          h(Field, { label: t('checkoutInto'), value: checkoutTarget, onChange: setCheckoutTarget, placeholder: '.' })),
        h(Btn, { onClick: () => void doCheckout(), disabled: loading || base.trim() === '', kind: 'primary' }, t('checkout')),
      ),
      output !== null && h(StatusLine, { text: output }),
    ),
  )
}
