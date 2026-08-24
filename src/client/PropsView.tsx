/** PropsView: svn:ignore and property management (propget / propset /
 *  proplist) for a chosen path. */
import { createElement as h, useState, type ReactNode } from 'react'
import type { SessionScope } from './api.ts'
import { api } from './api.ts'
import type { SvnStatusEntry } from './svn-types.ts'
import { Btn, Field, OutputBlock, Scroll, StatusLine } from './ui.tsx'

export interface PropsViewProps {
  scope: SessionScope
  t: (key: string) => string
  changedEntries: SvnStatusEntry[]
  visible: boolean
}

export function PropsView(props: PropsViewProps): ReactNode {
  const { scope, t } = props
  const [target, setTarget] = useState('')
  const [prop, setProp] = useState('svn:ignore')
  const [value, setValue] = useState('')
  const [propList, setPropList] = useState<Array<{ name: string; value: string }> | null>(null)
  const [output, setOutput] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const act = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const r = await fn()
      setOutput(typeof r === 'object' && r !== null && 'output' in r ? String((r as { output: unknown }).output) : JSON.stringify(r))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const pathSuggestions = props.changedEntries.slice(0, 8).map(e => e.path)
  return h(Scroll, { flex: true },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
      h(Field, { label: t('path'), value: target, onChange: setTarget, placeholder: '.', mono: true }),
      pathSuggestions.length > 0 && h('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } },
        pathSuggestions.map(p => h(Btn, { key: p, onClick: () => setTarget(p), title: p }, p.split('/').pop())),
      ),
      h('div', { style: { display: 'flex', gap: '6px', alignItems: 'flex-end' } },
        h('div', { style: { flex: '0 0 110px' } },
          h(Field, { label: t('propName'), value: prop, onChange: setProp, mono: true })),
        h(Btn, {
          onClick: () => {
            const listTarget = target.trim() === '' ? '.' : target.trim()
            void act(t('props'), () => api.proplist(scope, listTarget).then(r => { setPropList(r.props); return r }))
          },
          disabled: busy,
        }, 'proplist'),
      ),
      propList !== null && h('div', { style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '6px', padding: '6px', fontSize: '11px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', maxHeight: '140px', overflow: 'auto' } },
        propList.length === 0 ? h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, t('empty'))
          : propList.map(p => h('div', { key: p.name }, `${p.name} = ${p.value || t('empty')}`)),
      ),
      h(Field, { label: t('propValue'), value: value, onChange: setValue, rows: 3 }),
      error !== null && h(StatusLine, { text: error, error: true }),
      output !== null && h(OutputBlock, { text: output, maxHeight: 120 }),
      h(Btn, {
        onClick: () => void act(t('propset'), () => api.propset(scope, prop.trim(), value, target.trim() === '' ? '.' : target.trim())),
        disabled: busy || prop.trim() === '',
        kind: 'primary',
      }, `${t('propset')} ${prop.trim()}`),
    ),
  )
}
