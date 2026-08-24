/**
 * SvnView: the main SVN panel, styled after the dsh-better-sidebar Git panel
 * (VS Code-ish source control): a header row (repo url + refresh), status
 * sections (Changes / Untracked / Ignored-by-.gitignore) with letter badges
 * and icon actions, a bottom commit bar, and inline history. The other tool
 * pages (history, shelve, repo, branch, props, changelist, agent tools)
 * remain reachable from the page tabs.
 */
import { createElement as h, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Context } from 'dsh-better-sidebar'
import {
  IconBranchOutline16, IconChevronUpOutline14, IconCodeOutline16, IconInspectOutline12,
  IconPlusOutline16, IconRefreshOutline16, IconTrashOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionScope } from './api.ts'
import { api } from './api.ts'
import { ITEM_BADGE, ITEM_COLOR, type SvnInfoResult, type SvnStatusEntry, type SvnStatusResult } from './svn-types.ts'
import { Btn, Field, IconBtn, Modal, OutputBlock, Panel, Scroll, SectionHeader, StatusLine, Toolbar } from './ui.tsx'
import { HistoryView } from './HistoryView.tsx'
import { ShelveView } from './ShelveView.tsx'
import { RepoBrowserView } from './RepoBrowserView.tsx'
import { BranchView } from './BranchView.tsx'
import { PropsView } from './PropsView.tsx'
import { ChangeListView } from './ChangeListView.tsx'
import { AgentToolsView } from './AgentToolsView.tsx'
import { DiffView } from './DiffView.tsx'
import { BlameView } from './BlameView.tsx'

/** One page of the panel. */
export type SvnPage = 'status' | 'history' | 'shelve' | 'repo' | 'branch' | 'props' | 'changelist' | 'tools'

export interface SvnViewProps {
  ctx: Context
  scope: SessionScope
  t: (key: string) => string
  visible: boolean
}

const PAGE_ORDER: Array<{ id: SvnPage; label: string }> = [
  { id: 'status', label: 'status' },
  { id: 'history', label: 'history' },
  { id: 'shelve', label: 'shelve' },
  { id: 'repo', label: 'browseRepo' },
  { id: 'branch', label: 'branch' },
  { id: 'props', label: 'props' },
  { id: 'changelist', label: 'changelist' },
  { id: 'tools', label: 'tools' },
]

/** Is this entry a real change (visible in the Changes/Untracked sections)? */
function isChange(e: SvnStatusEntry): boolean {
  if (e.item === 'normal' || e.item === 'ignored') return false
  if (e.gitignored === true) return false
  return true
}

/** The status letter badge (Git-panel style). */
function badgeOf(e: SvnStatusEntry): string {
  return ITEM_BADGE[e.item] ?? '?'
}

export function SvnView(props: SvnViewProps): ReactNode {
  const { scope, t } = props
  const [page, setPage] = useState<SvnPage>('status')
  const [status, setStatus] = useState<SvnStatusResult | null>(null)
  const [info, setInfo] = useState<SvnInfoResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Success/notice output (shown in green, distinct from errors). */
  const [notice, setNotice] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [diffPath, setDiffPath] = useState<string | null>(null)
  const [blamePath, setBlamePath] = useState<string | null>(null)
  const [commitOpen, setCommitOpen] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [shelveCapable, setShelveCapable] = useState(true)
  const [showIgnored, setShowIgnored] = useState(false)
  /** Collapsed top-level sections ('changes' | 'untracked' | 'ignored'). */
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  /** Collapsed directory paths (relative, '/'-joined). */
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set())

  const refresh = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const [s, i] = await Promise.all([api.status(scope), api.info(scope)])
      setStatus(s)
      setInfo(i)
      setSelected(new Set())
      setDiffPath(null)
      setBlamePath(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    api.capabilities().then(c => setShelveCapable(c.shelve)).catch(() => setShelveCapable(true))
  }, [scope.sessionId, scope.cwd])

  const toggleSelect = (path: string): void => {
    const next = new Set(selected)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    setSelected(next)
  }

  const changedEntries = useMemo(() => {
    if (status === null) return []
    return status.entries.filter(isChange)
  }, [status])

  const untrackedEntries = useMemo(() => changedEntries.filter(e => e.item === 'unversioned'), [changedEntries])
  const versionedChanges = useMemo(() => changedEntries.filter(e => e.item !== 'unversioned'), [changedEntries])

  const ignoredEntries = useMemo(() => {
    if (status === null) return []
    return status.entries.filter(e => e.item === 'ignored' || e.gitignored === true)
  }, [status])

  const selectAll = (): void => {
    if (changedEntries.length === 0) return
    if (selected.size === changedEntries.length && changedEntries.every(e => selected.has(e.path))) {
      setSelected(new Set())
    } else {
      setSelected(new Set(changedEntries.map(e => e.path)))
    }
  }

  const runAction = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(label)
    setError(null)
    setNotice(null)
    try {
      const result = await fn()
      await refresh()
      if (typeof result === 'object' && result !== null && 'output' in result) {
        const output = (result as { output: string }).output
        if (output.trim() !== '') setNotice(output)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const selectedPaths = (): string[] => Array.from(selected)

  const doCommit = async (): Promise<void> => {
    const message = commitMsg.trim()
    if (message === '' || selected.size === 0 || busy !== null) return
    setCommitOpen(true)
  }

  const commitAllSelected = async (message: string, added: string[]): Promise<void> => {
    setBusy(t('commit'))
    setError(null)
    setNotice(null)
    try {
      if (added.length > 0) await api.add(scope, added)
      const result = await api.commit(scope, message, selectedPaths())
      setCommitMsg('')
      await refresh()
      setNotice(`✔ ${t('success')}: r${result.revision}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const busyFlag = busy !== null

  return h('div', {
    'data-dsh-svn-count': changedEntries.length > 0 ? String(changedEntries.length) : undefined,
    style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' },
  },
    h(Panel, null,
      // ── header: repo url + refresh (gitHeader style) ────────────────────
      h('div', {
        style: {
          flex: 'none', display: 'flex', alignItems: 'center', gap: '8px',
          height: '36px', padding: '0 8px 0 12px',
        },
      },
        h('div', {
          style: {
            flex: '1', minWidth: '0', display: 'flex', alignItems: 'center', gap: '6px',
            overflow: 'hidden',
          },
          title: info?.url,
        },
          h(IconBranchOutline16, { size: 14 }),
          h('span', {
            style: {
              flex: '1', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              font: 'var(--dsw-font-xxs-12)', color: 'var(--dsw-alias-label-primary)',
            },
          }, info?.url ?? t('noUrl')),
          info !== null && h('span', {
            style: { font: 'var(--dsw-font-xxxs-11)', color: 'var(--dsw-alias-label-tertiary)', flex: 'none' },
          }, `r${info.revision ?? '?'}`),
        ),
        h(IconBtn, { onClick: () => void refresh(), disabled: loading || busyFlag, title: t('refresh') },
          h(IconRefreshOutline16, { size: 14 })),
      ),

      // ── page tabs ───────────────────────────────────────────────────────
      h(Toolbar, { },
        PAGE_ORDER.map(p => h(Btn, {
          key: p.id,
          onClick: () => { setPage(p.id); setDiffPath(null); setBlamePath(null) },
          kind: page === p.id ? 'primary' : 'default',
          title: t(p.label),
        }, t(p.label))),
      ),

      // ── status page ─────────────────────────────────────────────────────
      page === 'status' && h(Scroll, { flex: true },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
          error !== null && h(StatusLine, { text: error, error: true }),
          notice !== null && h(StatusLine, { text: notice, success: true }),
          busy !== null && h(StatusLine, { text: `${t('busy')} ${busy}` }),

          // not a working copy → inline checkout
          status !== null && !status.isWorkCopy && h('div', { style: { padding: '16px 4px' } },
            h('div', { style: { font: 'var(--dsw-font-s-strong-14)', color: 'var(--dsw-alias-label-primary)', marginBottom: '6px' } }, t('notWorkCopy')),
            h('div', { style: { font: 'var(--dsw-font-xxs-12)', color: 'var(--dsw-alias-label-tertiary)', lineHeight: 1.6 } }, t('notWorkCopyHint')),
            h('div', { style: { marginTop: '10px' } },
              h(CheckoutInline, { scope, t, onDone: () => void refresh() }),
            ),
          ),

          status !== null && status.isWorkCopy && !loading && h(StatusPage, {
            t,
            scope,
            versionedChanges,
            untrackedEntries,
            ignoredEntries,
            showIgnored,
            selected,
            busy: busyFlag,
            commitMsg,
            collapsedSections,
            collapsedDirs,
            onCommitMsg: setCommitMsg,
            onToggleSelect: toggleSelect,
            onSelectAll: selectAll,
            onToggleIgnored: () => setShowIgnored(v => !v),
            onToggleSection: (id: string) => {
              setCollapsedSections(prev => {
                const next = new Set(prev)
                if (next.has(id)) next.delete(id)
                else next.add(id)
                return next
              })
            },
            onToggleDir: (dir: string) => {
              setCollapsedDirs(prev => {
                const next = new Set(prev)
                if (next.has(dir)) next.delete(dir)
                else next.add(dir)
                return next
              })
            },
            onDiff: (p) => { setDiffPath(p); setBlamePath(null) },
            onBlame: (p) => { setBlamePath(p); setDiffPath(null) },
            onAction: (label, fn) => void runAction(label, fn),
            onCommit: doCommit,
            shelveCapable,
          }),

          loading && status === null && h(StatusLine, { text: t('loading') }),
          status !== null && status.isWorkCopy && !loading && changedEntries.length === 0 && ignoredEntries.length === 0
            && h(StatusLine, { text: t('emptyChanges') }),
        ),
      ),

      // ── other pages ─────────────────────────────────────────────────────
      page === 'history' && h(HistoryView, { scope, t, visible: props.visible }),
      page === 'shelve' && h(ShelveView, { scope, t, onChanged: () => void refresh(), visible: props.visible, shelveCapable }),
      page === 'repo' && h(RepoBrowserView, { scope, t, info, visible: props.visible }),
      page === 'branch' && h(BranchView, { scope, t, info, visible: props.visible }),
      page === 'props' && h(PropsView, { scope, t, changedEntries, visible: props.visible }),
      page === 'changelist' && h(ChangeListView, { scope, t, changedEntries, visible: props.visible }),
      page === 'tools' && h(AgentToolsView, { t }),

      // ── inline diff / blame detail ──────────────────────────────────────
      diffPath !== null && h('div', { style: { flex: '0 0 auto', maxHeight: '45%', display: 'flex', flexDirection: 'column', minHeight: '0', borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: '6px' } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' } },
          h('span', { style: { font: 'var(--dsw-font-xxs-strong-12)', color: 'var(--dsw-alias-label-primary)', wordBreak: 'break-all' } }, diffPath),
          h(IconBtn, { onClick: () => setDiffPath(null), title: t('close') }, h(IconChevronUpOutline14, {})),
        ),
        h('div', { style: { flex: '1 1 auto', minHeight: '0', overflow: 'hidden' } },
          h(DiffView, { scope, t, path: diffPath }),
        ),
      ),
      blamePath !== null && h('div', { style: { flex: '0 0 auto', maxHeight: '45%', display: 'flex', flexDirection: 'column', minHeight: '0', borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: '6px' } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' } },
          h('span', { style: { font: 'var(--dsw-font-xxs-strong-12)', color: 'var(--dsw-alias-label-primary)', wordBreak: 'break-all' } }, `${t('blame')}: ${blamePath}`),
          h(IconBtn, { onClick: () => setBlamePath(null), title: t('close') }, h(IconChevronUpOutline14, {})),
        ),
        h('div', { style: { flex: '1 1 auto', minHeight: '0', overflow: 'hidden' } },
          h(BlameView, { scope, t, path: blamePath }),
        ),
      ),

      commitOpen && h(CommitDialog, {
        scope,
        t,
        paths: selectedPaths(),
        onClose: () => setCommitOpen(false),
        onCommitted: (message, added) => void commitAllSelected(message, added),
      }),
    ),
  )
}

/** A node in the status directory tree (folder rows + file rows). */
type DirNode =
  | { type: 'dir'; name: string; path: string; count: number; children: DirNode[] }
  | { type: 'file'; entry: SvnStatusEntry }

/** Group flat status entries into a directory tree (path split on '/'). */
function buildDirTree(entries: SvnStatusEntry[]): DirNode[] {
  const root: Extract<DirNode, { type: 'dir' }> = { type: 'dir', name: '', path: '', count: 0, children: [] }
  for (const e of entries) {
    const parts = e.path.split('/').filter(Boolean)
    let cur = root
    if (parts.length > 1) {
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts.slice(0, i + 1).join('/')
        let next = cur.children.find((c): c is Extract<DirNode, { type: 'dir' }> => c.type === 'dir' && c.path === p)
        if (next === undefined) {
          next = { type: 'dir', name: parts[i]!, path: p, count: 0, children: [] }
          cur.children.push(next)
        }
        cur = next
      }
    }
    cur.children.push({ type: 'file', entry: e })
  }
  // Count: a dir's count = files directly inside it + all subdir counts.
  const countNode = (n: DirNode): number => {
    if (n.type === 'file') return 1
    let c = 0
    for (const kid of n.children) c += countNode(kid)
    n.count = c
    return c
  }
  countNode(root)
  return root.children
}
function StatusPage(props: {
  t: (key: string) => string
  scope: SessionScope
  versionedChanges: SvnStatusEntry[]
  untrackedEntries: SvnStatusEntry[]
  ignoredEntries: SvnStatusEntry[]
  showIgnored: boolean
  selected: Set<string>
  busy: boolean
  commitMsg: string
  collapsedSections: Set<string>
  collapsedDirs: Set<string>
  onCommitMsg: (v: string) => void
  onToggleSelect: (path: string) => void
  onSelectAll: () => void
  onToggleIgnored: () => void
  onToggleSection: (id: string) => void
  onToggleDir: (dir: string) => void
  onDiff: (path: string) => void
  onBlame: (path: string) => void
  onAction: (label: string, fn: () => Promise<unknown>) => void
  onCommit: () => void
  shelveCapable: boolean
}): ReactNode {
  const { t, scope } = props

  const renderRow = (e: SvnStatusEntry, dimmed = false, depth = 0): ReactNode => {
    const color = ITEM_COLOR[e.item] ?? 'var(--dsw-alias-label-secondary)'
    const badge = badgeOf(e)
    const isUntracked = e.item === 'unversioned'
    const isConflicted = e.item === 'conflicted'
    const checkable = !e.gitignored
    return h('div', {
      key: e.path,
      style: {
        display: 'flex', alignItems: 'center', gap: '6px', minHeight: '34px',
        margin: '0 6px', paddingLeft: `${8 + depth * 14}px`, paddingRight: '8px', borderRadius: '8px',
        opacity: dimmed ? 0.6 : 1,
      },
    },
      // checkbox
      checkable && h('input', {
        type: 'checkbox',
        checked: props.selected.has(e.path),
        onChange: () => props.onToggleSelect(e.path),
        style: { flex: '0 0 auto', accentColor: 'var(--dsw-alias-brand-primary)' },
        title: t('select'),
      }),
      // letter badge (Git-panel style square)
      h('span', {
        style: {
          flex: 'none', width: '20px', height: '16px', display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center', borderRadius: '4px',
          font: 'var(--dsw-font-xxxs-strong-11)',
          background: 'color-mix(in srgb, ' + color + ' 18%, transparent)',
          color,
        },
        title: t('statusItem'),
      }, badge),
      // path (click opens diff when versioned)
      h('button', {
        type: 'button',
        style: {
          flex: '1', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          border: 'none', background: 'transparent', padding: '3px 0', cursor: 'pointer', textAlign: 'left',
          font: 'var(--dsw-font-s-14)', color: 'var(--dsw-alias-label-primary)',
        },
        title: e.path,
        onClick: () => { if (!isUntracked) props.onDiff(e.path) },
      }, e.path),
      // actions
      !isUntracked && h(IconBtn, { title: t('diff'), onClick: () => props.onDiff(e.path) }, h(IconCodeOutline16, { size: 14 })),
      !isUntracked && h(IconBtn, { title: t('blame'), onClick: () => props.onBlame(e.path) }, h(IconInspectOutline12, {})),
      !isUntracked && (e.item === 'modified' || e.item === 'added' || e.item === 'deleted' || e.item === 'missing')
      && h(IconBtn, { title: t('revert'), onClick: () => props.onAction(t('revert'), () => api.revert(scope, [e.path])) },
        h(IconTrashOutline16, { size: 14 })),
      isUntracked && h(IconBtn, {
        title: t('add'), disabled: props.busy,
        onClick: () => props.onAction(t('add'), () => api.add(scope, [e.path])),
      }, h(IconPlusOutline16, { size: 14 })),
      isConflicted && h('div', { style: { display: 'flex', gap: '2px' } },
        h(Btn, { title: t('resolveWorking'), onClick: () => props.onAction(t('resolve'), () => api.resolve(scope, e.path, 'working', true)) }, 'W'),
        h(Btn, { title: t('resolveMine'), onClick: () => props.onAction(t('resolve'), () => api.resolve(scope, e.path, 'mine-full', true)) }, 'M'),
        h(Btn, { title: t('resolveTheirs'), onClick: () => props.onAction(t('resolve'), () => api.resolve(scope, e.path, 'theirs-full', true)) }, 'T'),
      ),
    )
  }

  /** Render one entry list as a collapsible directory tree (IDEA style):
   *  directories become folder rows; files are indented under them. */
  const renderTree = (entries: SvnStatusEntry[], dimmed = false): ReactNode => {
    const tree = buildDirTree(entries)
    const renderNodes = (nodes: DirNode[], depth: number): ReactNode => {
      return nodes.map(n => {
        if (n.type === 'dir') {
          const collapsed = props.collapsedDirs.has(n.path)
          return h('div', { key: 'd:' + n.path },
            h('div', {
              style: {
                display: 'flex', alignItems: 'center', gap: '4px', minHeight: '28px', cursor: 'pointer',
                margin: '0 6px', paddingLeft: `${8 + depth * 14}px`, paddingRight: '8px', borderRadius: '6px',
                color: 'var(--dsw-alias-label-secondary)',
                font: 'var(--dsw-font-xxs-strong-12)',
              },
              onClick: () => props.onToggleDir(n.path),
              title: n.path,
            },
              h('span', {
                style: {
                  flex: 'none', display: 'inline-block', width: '10px', height: '10px', fontSize: '8px',
                  transform: collapsed ? 'rotate(-90deg)' : 'none',
                  transition: 'transform .12s ease',
                },
              }, '▼'),
              h('span', {
                style: {
                  flex: 'none', width: '20px', height: '16px', display: 'inline-flex',
                  alignItems: 'center', justifyContent: 'center', borderRadius: '4px',
                  font: 'var(--dsw-font-xxxs-strong-11)',
                  background: 'var(--dsw-alias-interactive-bg-hover)',
                  color: 'var(--dsw-alias-label-tertiary)',
                },
              }, `${n.count}`),
              h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, n.name + '/'),
            ),
            !collapsed && renderNodes(n.children, depth + 1),
          )
        }
        return renderRow(n.entry, dimmed, depth)
      })
    }
    return renderNodes(tree, 0)
  }

  const renderSection = (
    id: string,
    titleKey: string,
    entries: SvnStatusEntry[],
    dimmed: boolean,
    actionLabel?: string,
    onAction?: () => void,
  ): ReactNode => {
    const collapsed = props.collapsedSections.has(id)
    return h('div', { style: { borderTop: '1px solid var(--dsw-alias-border-l1)' } },
      h(SectionHeader, {
        title: t(titleKey),
        count: entries.length,
        actionLabel,
        onAction,
        collapsed,
        onToggle: () => props.onToggleSection(id),
        titleExpand: t('expand'),
        titleCollapse: t('collapse'),
      }),
      !collapsed && (entries.length === 0
        ? h('div', { style: { padding: '4px 12px 8px', font: 'var(--dsw-font-xxs-12)', color: 'var(--dsw-alias-label-tertiary)' } }, t('noChanges'))
        : renderTree(entries, dimmed)),
    )
  }

  return h('div', { style: { display: 'flex', flexDirection: 'column' } },
    // Changes section
    renderSection('changes', 'changes', props.versionedChanges, false,
      props.versionedChanges.length > 0 ? (props.selected.size === props.versionedChanges.length ? t('clear') : t('selectAll')) : undefined,
      props.onSelectAll),
    // Untracked section
    renderSection('untracked', 'untracked', props.untrackedEntries, false),
    // Ignored section (collapsible; hidden unless "show" is toggled)
    props.ignoredEntries.length > 0 && h('div', { style: { borderTop: '1px solid var(--dsw-alias-border-l1)' } },
      h(SectionHeader, {
        title: t('ignored'),
        count: props.ignoredEntries.length,
        actionLabel: props.showIgnored ? t('hide') : t('show'),
        onAction: props.onToggleIgnored,
        collapsed: props.collapsedSections.has('ignored'),
        onToggle: () => props.onToggleSection('ignored'),
        titleExpand: t('expand'),
        titleCollapse: t('collapse'),
      }),
      !props.collapsedSections.has('ignored') && props.showIgnored && renderTree(props.ignoredEntries, true),
    ),
    // commit bar
    h('div', {
      style: {
        display: 'flex', gap: '6px', padding: '8px 12px',
        borderTop: '1px solid var(--dsw-alias-border-l1)', alignItems: 'center',
      },
    },
      h('input', {
        style: {
          flex: '1', minWidth: '0', height: '28px', padding: '0 8px', boxSizing: 'border-box',
          border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '6px',
          background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)',
          font: 'var(--dsw-font-xxs-12)',
        },
        placeholder: t('commitPlaceholder'),
        value: props.commitMsg,
        disabled: props.busy,
        onChange: (ev: { target: { value: string } }) => props.onCommitMsg(ev.target.value),
        onKeyDown: (ev: { ctrlKey: boolean; metaKey: boolean; key: string; preventDefault(): void }) => {
          if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
            ev.preventDefault()
            props.onCommit()
          }
        },
      }),
      h('button', {
        type: 'button',
        style: {
          flex: 'none', height: '28px', padding: '0 14px', border: 'none', borderRadius: '6px',
          background: 'var(--dsw-alias-button-primary-fill)', color: 'var(--dsw-alias-label-primary-inverted)',
          font: 'var(--dsw-font-xxs-strong-12)', cursor: props.busy ? 'default' : 'pointer',
          opacity: props.busy || props.commitMsg.trim() === '' || props.selected.size === 0 ? 0.45 : 1,
        },
        disabled: props.busy || props.commitMsg.trim() === '' || props.selected.size === 0,
        onClick: props.onCommit,
      }, t('commit')),
    ),
    // SVN-specific quick actions (update / shelve / cleanup)
    h('div', {
      style: {
        display: 'flex', gap: '6px', padding: '2px 12px 8px', flexWrap: 'wrap',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
    },
      h(Btn, {
        onClick: () => props.onAction(t('update'), () => api.update(props.scope)),
        disabled: props.busy,
        title: t('update'),
      }, '⤓ ' + t('update')),
      h(Btn, {
        onClick: () => props.onAction(t('shelve'), () => api.shelve(props.scope, `shelve-${Date.now().toString(36)}`, Array.from(props.selected))),
        disabled: props.busy || props.selected.size === 0 || !props.shelveCapable,
        title: props.shelveCapable ? t('shelve') : t('shelveUnavailable'),
      }, '▤ ' + t('shelve')),
      h(Btn, {
        onClick: () => props.onAction(t('cleanup'), () => api.cleanup(props.scope)),
        disabled: props.busy,
        title: t('cleanup'),
      }, t('cleanup')),
    ),
    // shelve hint (TortoiseSVN has no shelve)
    props.shelveCapable === false && h('div', {
      style: { padding: '4px 12px 8px', font: 'var(--dsw-font-xxxs-11)', color: 'var(--dsw-alias-label-tertiary)' },
    }, t('shelveUnavailable')),
  )
}

/** Inline checkout form (shown when the cwd is not a working copy). */
function CheckoutInline(props: { scope: SessionScope; t: (key: string) => string; onDone: () => void }): ReactNode {
  const [url, setUrl] = useState('')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const doCheckout = async (): Promise<void> => {
    if (url.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      await api.checkout(props.scope, url.trim(), target.trim() === '' ? undefined : target.trim())
      props.onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return h('div', { style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px', padding: '10px' } },
    h('div', { style: { font: 'var(--dsw-font-xxs-strong-12)', color: 'var(--dsw-alias-label-primary)', marginBottom: '6px' } }, props.t('checkout')),
    h(Field, { label: props.t('url'), value: url, onChange: setUrl, placeholder: props.t('repoUrlPlaceholder'), mono: true }),
    h(Field, { label: props.t('checkoutInto'), value: target, onChange: setTarget, placeholder: '.' }),
    error !== null && h(StatusLine, { text: error, error: true }),
    h(Btn, { onClick: () => void doCheckout(), disabled: busy || url.trim() === '', kind: 'primary' }, props.t('checkout')),
  )
}

/** Commit dialog: message + selected files + optional add-new check. */
function CommitDialog(props: {
  scope: SessionScope
  t: (key: string) => string
  paths: string[]
  onClose: () => void
  onCommitted: (message: string, added: string[]) => void
}): ReactNode {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string[]>([])
  const doCommit = async (): Promise<void> => {
    if (message.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      props.onCommitted(message.trim(), added)
      setMessage('')
      props.onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return h(Modal, { title: props.t('commit'), onClose: props.onClose, width: 560 },
    h(Field, { label: props.t('message'), value: message, onChange: setMessage, placeholder: props.t('commitMessagePlaceholder'), rows: 4 }),
    h('div', { style: { font: 'var(--dsw-font-xxs-12)', color: 'var(--dsw-alias-label-secondary)', marginBottom: '6px' } }, `${props.t('changedFiles')} (${props.paths.length}):`),
    h('div', { style: { maxHeight: '180px', overflow: 'auto', marginBottom: '8px' } },
      props.paths.map(p => h('div', {
        key: p,
        style: { display: 'flex', alignItems: 'center', gap: '6px', font: 'var(--dsw-font-xxs-12)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
      },
        h('input', {
          type: 'checkbox',
          checked: added.includes(p),
          onChange: () => { setAdded(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]) },
          style: { accentColor: 'var(--dsw-alias-brand-primary)' },
        }),
        p,
      )),
    ),
    error !== null && h(StatusLine, { text: error, error: !error.startsWith('✔') }),
    h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '8px' } },
      h(Btn, { onClick: props.onClose, disabled: busy }, props.t('cancel')),
      h(Btn, { onClick: () => void doCommit(), disabled: busy || message.trim() === '', kind: 'primary' }, props.t('commitSelected')),
    ),
  )
}
