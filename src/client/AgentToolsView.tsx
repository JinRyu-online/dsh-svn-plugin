/** AgentToolsView: informational page listing the registered svn_* model
 *  tools (the host registers them; this page documents their use). */
import { createElement as h, type ReactNode } from 'react'
import { Scroll } from './ui.tsx'

export interface AgentToolsViewProps {
  t: (key: string) => string
}

const TOOLS = [
  ['svn_status', 'svn status --xml'],
  ['svn_log', 'svn log --xml -v'],
  ['svn_diff', 'svn diff [-r a:b] [path]'],
  ['svn_commit', 'svn commit -m "..." [paths]'],
  ['svn_update', 'svn update'],
  ['svn_revert', 'svn revert <paths>'],
  ['svn_add', 'svn add <paths>'],
  ['svn_shelve', 'svn shelve --keep-local <name> [paths]'],
  ['svn_unshelve', 'svn unshelve <name> [--drop]'],
  ['svn_shelve_list', 'svn shelve --list'],
  ['svn_blame', 'svn blame <path>'],
]

export function AgentToolsView(props: AgentToolsViewProps): ReactNode {
  return h(Scroll, { flex: true },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
      h('div', { style: { fontSize: '14px', fontWeight: 600 } }, props.t('agents')),
      h('div', { style: { fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)' } }, props.t('agentsHint')),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11px' } },
        TOOLS.map(([name, cmd]) => h('div', { key: name, style: { display: 'flex', gap: '8px' } },
          h('span', { style: { flex: '0 0 110px', color: 'var(--dsw-alias-brand-primary)' } }, name),
          h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, cmd),
        )),
      ),
    ),
  )
}
