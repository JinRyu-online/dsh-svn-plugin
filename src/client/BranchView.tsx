/** BranchView: branch/tag management — create from a URL (svn copy),
 *  switch the working copy, and merge revision ranges. */
import { createElement as h, useState, type ReactNode } from 'react'
import type { SessionScope } from './api.ts'
import { api } from './api.ts'
import type { SvnInfoResult } from './svn-types.ts'
import { Btn, Field, OutputBlock, Scroll, StatusLine } from './ui.tsx'

export interface BranchViewProps {
  scope: SessionScope
  t: (key: string) => string
  info: SvnInfoResult | null
  visible: boolean
}

export function BranchView(props: BranchViewProps): ReactNode {
  const { scope, t, info } = props
  const [fromUrl, setFromUrl] = useState(info?.url ?? '')
  const [toUrl, setToUrl] = useState('')
  const [branchMsg, setBranchMsg] = useState('')
  const [switchUrl, setSwitchUrl] = useState('')
  const [mergeUrl, setMergeUrl] = useState('')
  const [mergeRange, setMergeRange] = useState('')
  const [output, setOutput] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const act = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError(null)
    setOutput(null)
    try {
      const r = await fn()
      setOutput(typeof r === 'object' && r !== null && 'output' in r ? String((r as { output: unknown }).output) : JSON.stringify(r))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return h(Scroll, { flex: true },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
      error !== null && h(StatusLine, { text: error, error: true }),
      output !== null && h(OutputBlock, { text: output, maxHeight: 140 }),

      // branch/tag creation
      h('fieldset', { style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px', padding: '8px 10px', margin: 0 } },
        h('legend', { style: { fontSize: '12px', fontWeight: 600 } }, t('branch')),
        h(Field, { label: t('copyFrom'), value: fromUrl, onChange: setFromUrl, mono: true }),
        h(Field, { label: t('copyTo'), value: toUrl, onChange: setToUrl, placeholder: t('branchNamePlaceholder'), mono: true }),
        h(Field, { label: t('message'), value: branchMsg, onChange: setBranchMsg }),
        h(Btn, {
          onClick: () => void act(t('createBranch'), () => api.copyUrl(scope, fromUrl, toUrl, branchMsg.trim())),
          disabled: busy || fromUrl.trim() === '' || toUrl.trim() === '' || branchMsg.trim() === '',
          kind: 'primary',
        }, t('createBranch')),
      ),

      // switch
      h('fieldset', { style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px', padding: '8px 10px', margin: 0 } },
        h('legend', { style: { fontSize: '12px', fontWeight: 600 } }, t('switch')),
        h(Field, { label: t('switchToUrl'), value: switchUrl, onChange: setSwitchUrl, placeholder: t('repoUrlPlaceholder'), mono: true }),
        h(Btn, {
          onClick: () => void act(t('switch'), () => api.switchTo(scope, switchUrl.trim())),
          disabled: busy || switchUrl.trim() === '',
        }, t('switch')),
      ),

      // merge
      h('fieldset', { style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px', padding: '8px 10px', margin: 0 } },
        h('legend', { style: { fontSize: '12px', fontWeight: 600 } }, t('merge')),
        h(Field, { label: t('mergeFrom'), value: mergeUrl, onChange: setMergeUrl, placeholder: t('repoUrlPlaceholder'), mono: true }),
        h(Field, { label: t('mergeRevRange'), value: mergeRange, onChange: setMergeRange, placeholder: '100:120' }),
        h(Btn, {
          onClick: () => {
            const range = mergeRange.trim()
            const m = /^(\d+):(\d+)$/.exec(range)
            void act(t('doMerge'), () => api.merge(scope, mergeUrl.trim(), m?.[1], m?.[2]))
          },
          disabled: busy || mergeUrl.trim() === '' || (mergeRange.trim() !== '' && !/^\d+:\d+$/.test(mergeRange.trim())),
        }, t('doMerge')),
        mergeRange.trim() !== '' && !/^\d+:\d+$/.test(mergeRange.trim())
          && h(StatusLine, { text: t('mergeRevRange'), error: true }),
      ),
    ),
  )
}
