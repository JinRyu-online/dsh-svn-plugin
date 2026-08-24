/** ChangeListView: svn changelist — group paths for selective commits. */
import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import type { SessionScope } from './api.ts'
import { api } from './api.ts'
import type { SvnStatusEntry } from './svn-types.ts'
import { Btn, Field, OutputBlock, Scroll, StatusLine } from './ui.tsx'

export interface ChangeListViewProps {
  scope: SessionScope
  t: (key: string) => string
  changedEntries: SvnStatusEntry[]
  visible: boolean
}

export function ChangeListView(props: ChangeListViewProps): ReactNode {
  const { scope, t, changedEntries } = props
  const [groups, setGroups] = useState<Array<{ name: string; paths: string[] }> | null>(null)
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [output, setOutput] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async (): Promise<void> => {
    setError(null)
    try {
      const r = await api.changelist(scope)
      setGroups('groups' in r ? r.groups : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => { void load() }, [scope.sessionId, scope.cwd])

  const act = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const r = await fn()
      setOutput(typeof r === 'object' && r !== null && 'output' in r ? String((r as { output: unknown }).output) : JSON.stringify(r))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return h(Scroll, { flex: true },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
      h('div', { style: { display: 'flex', gap: '6px', alignItems: 'flex-end' } },
        h('div', { style: { flex: '1 1 auto' } },
          h(Field, { label: t('changelist'), value: name, onChange: setName, placeholder: 'my-changelist' })),
        h('div', { style: { flex: '1 1 auto' } },
          h(Field, { label: t('path'), value: target, onChange: setTarget, placeholder: 'path/to/file', mono: true })),
        h(Btn, {
          onClick: () => void act(t('changelist'), () => api.changelist(scope, name.trim(), target.trim())),
          disabled: busy || name.trim() === '' || target.trim() === '',
          kind: 'primary',
        }, '→'),
      ),
      changedEntries.slice(0, 10).map(e => h(Btn, { key: e.path, onClick: () => setTarget(e.path), title: e.path }, e.path.split('/').pop())),
      error !== null && h(StatusLine, { text: error, error: true }),
      output !== null && h(OutputBlock, { text: output, maxHeight: 120 }),
      groups !== null && groups.length > 0 && h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        groups.map(g => h('div', { key: g.name, style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '6px', padding: '6px' } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' } },
            h('span', { style: { fontSize: '12px', fontWeight: 600 } }, g.name),
            h(Btn, {
              onClick: () => {
                // Remove each member sequentially so the shared busy flag stays
                // true until the whole group is removed.
                void (async () => {
                  setBusy(true)
                  setError(null)
                  try {
                    for (const p of g.paths) {
                      await api.changelist(scope, g.name, p, true)
                    }
                    await load()
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e))
                  } finally {
                    setBusy(false)
                  }
                })()
              },
              disabled: busy,
              kind: 'danger',
            }, '✕'),
          ),
          g.paths.map(p => h('div', { key: p, style: { fontSize: '11px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: 'var(--dsw-alias-label-secondary)' } }, p)),
        )),
      ),
    ),
  )
}
