/** Shared wire types between the client views and the /svn/api host. */

/** One `svn status` entry (mirror of the host shape). */
export interface SvnStatusEntry {
  path: string
  item: string
  props: string
  revision: number
  lastChangedRevision?: number
  lastChangedAuthor?: string
  /** Unversioned path matched by a .gitignore rule (host-computed). */
  gitignored?: boolean
}

/** The status snapshot. */
export interface SvnStatusResult {
  isWorkCopy: boolean
  url?: string
  revision?: number
  entries: SvnStatusEntry[]
}

/** One `svn log` row. */
export interface SvnLogEntry {
  revision: string
  author: string
  date: string
  message: string
  changedPaths: Array<{ action: string; path: string; kind: string }>
}

/** One `svn blame` line. */
export interface SvnBlameLine {
  lineNumber: number
  revision: string
  author: string
  text: string
}

/** One `svn info` result. */
export interface SvnInfoResult {
  isWorkCopy: boolean
  url?: string
  reposRoot?: string
  reposUuid?: string
  revision?: number
  lastChangedRevision?: number
  lastChangedAuthor?: string
  schedule?: string
  wcRoot?: string
  depth?: string
}

/** One shelve row. */
export interface SvnShelveEntry {
  name: string
  keep: boolean
  version: number
  summary: string
}

/** One `svn list` entry. */
export interface SvnListEntry {
  name: string
  kind: string
  size?: number
  revision?: number
  author?: string
  date?: string
}

/** Human-readable labels for status items (svn status --xml `item` values). */
export const ITEM_LABEL: Record<string, string> = {
  'normal': '正常',
  'modified': '已修改',
  'added': '已添加',
  'deleted': '已删除',
  'unversioned': '未版本化',
  'missing': '缺失',
  'conflicted': '冲突',
  'obstructed': '被阻塞',
  'ignored': '已忽略',
  'external': '外部',
  'incomplete': '不完整',
  'merged': '已合并',
}

/** Short one-letter badge for each status item — the Git-panel style compact
 *  status mark (M/A/D/?/!/C…) shown in the row's square badge. */
export const ITEM_BADGE: Record<string, string> = {
  'normal': ' ',
  'modified': 'M',
  'added': 'A',
  'deleted': 'D',
  'unversioned': '?',
  'missing': '!',
  'conflicted': 'C',
  'obstructed': '~',
  'ignored': 'I',
  'external': 'X',
  'incomplete': '!',
  'merged': 'G',
}

/** Colors for status items (DSW tokens — the design language shared by the
 *  dsh-better-sidebar Git panel). */
export const ITEM_COLOR: Record<string, string> = {
  'normal': 'var(--dsw-alias-label-tertiary)',
  'modified': 'var(--dsw-alias-state-warning-primary, #d99a00)',
  'added': 'var(--dsw-alias-state-success-primary)',
  'deleted': 'var(--dsw-alias-state-error-primary)',
  'unversioned': 'var(--dsw-alias-label-secondary)',
  'missing': 'var(--dsw-alias-state-error-primary)',
  'conflicted': 'var(--dsw-alias-state-error-primary)',
  'obstructed': 'var(--dsw-alias-state-warning-primary, #d99a00)',
  'ignored': 'var(--dsw-alias-label-tertiary)',
  'external': 'var(--dsw-alias-label-tertiary)',
  'incomplete': 'var(--dsw-alias-state-warning-primary, #d99a00)',
}
