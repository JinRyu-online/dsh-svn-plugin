/**
 * Small shared UI atoms for the SVN panel. Styling mirrors the
 * dsh-better-sidebar Git panel design language: DSW alias tokens
 * (--dsw-alias-*) for colors and --dsw-font-* for type, plain inline styles
 * (the bundle has no CSS pipeline; the loader injects plugin-owned <style>
 * tags only for CSS modules, which this plugin deliberately does not use).
 */
import { createElement as h, type ReactNode } from 'react'

/** The active locale dictionary (swapped by the root). */
export type Dict = Record<string, string>

/** Simple t() with a locale dictionary. */
export function makeT(dict: Dict): (key: string) => string {
  return (key: string) => dict[key] ?? key
}

/** A soft panel button (Git-panel style: ghost fill, DSW tokens). */
export function Btn(props: {
  onClick?: (ev: { stopPropagation(): void }) => void
  disabled?: boolean
  title?: string
  kind?: 'default' | 'primary' | 'danger' | 'link'
  children?: ReactNode
}): ReactNode {
  const kind = props.kind ?? 'default'
  const base: Record<string, string | number> = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '3px 8px',
    borderRadius: '6px',
    border: kind === 'link' ? 'none' : '1px solid var(--dsw-alias-border-l2)',
    background: kind === 'primary'
      ? 'var(--dsw-alias-button-primary-fill)'
      : kind === 'danger'
        ? 'var(--dsw-alias-state-error-primary)'
        : 'transparent',
    color: kind === 'primary' || kind === 'danger'
      ? 'var(--dsw-alias-label-primary-inverted)'
      : kind === 'link'
        ? 'var(--dsw-alias-brand-primary)'
        : 'var(--dsw-alias-label-secondary)',
    font: 'var(--dsw-font-xxs-12)',
    lineHeight: '18px',
    cursor: props.disabled === true ? 'default' : 'pointer',
    opacity: props.disabled === true ? 0.45 : 1,
    whiteSpace: 'nowrap',
  }
  if (kind === 'link') base.padding = '0'
  return h('button', {
    style: base,
    onClick: props.disabled === true ? undefined : props.onClick,
    disabled: props.disabled === true,
    title: props.title,
    type: 'button',
  }, props.children)
}

/** A 28px circular icon button — the app's icon-button pattern (iconButton). */
export function IconBtn(props: {
  onClick?: (ev: { stopPropagation(): void }) => void
  disabled?: boolean
  title?: string
  children?: ReactNode
}): ReactNode {
  return h('button', {
    type: 'button',
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '28px',
      height: '28px',
      padding: '0',
      border: 'none',
      borderRadius: '50%',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      cursor: props.disabled === true ? 'default' : 'pointer',
      flex: 'none',
      opacity: props.disabled === true ? 0.4 : 1,
    },
    onClick: props.disabled === true ? undefined : props.onClick,
    disabled: props.disabled === true,
    title: props.title,
  }, props.children)
}

/** A labeled text input row (Git-panel style field). */
export function Field(props: {
  label?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  mono?: boolean
  rows?: number
}): ReactNode {
  const label = props.label === undefined
    ? null
    : h('div', { style: { font: 'var(--dsw-font-xxxs-11)', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '3px' } }, props.label)
  const inputStyle: Record<string, string> = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '4px 6px',
    borderRadius: '6px',
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-bg-base)',
    color: 'var(--dsw-alias-label-primary)',
    font: 'var(--dsw-font-xxs-12)',
    lineHeight: '18px',
    fontFamily: props.mono === true ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'inherit',
    resize: 'vertical',
  }
  const input = props.rows !== undefined
    ? h('textarea', { style: inputStyle, value: props.value, rows: props.rows, placeholder: props.placeholder, onChange: (e: { target: { value: string } }) => props.onChange(e.target.value) })
    : h('input', { style: inputStyle, type: 'text', value: props.value, placeholder: props.placeholder, onChange: (e: { target: { value: string } }) => props.onChange(e.target.value) })
  if (props.label === undefined) return input
  return h('div', { style: { marginBottom: '8px' } }, label, input)
}

/** A modal dialog shell (DSW tokens). */
export function Modal(props: { title: string; children?: ReactNode; onClose: () => void; width?: number }): ReactNode {
  return h('div', {
    style: {
      position: 'fixed', inset: '0', zIndex: 2147483001,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,.45)',
    },
    onClick: props.onClose,
  }, h('div', {
    style: {
      width: `${props.width ?? 520}px`, maxWidth: '92vw', maxHeight: '82vh', overflow: 'auto',
      background: 'var(--dsw-alias-bg-raised, #1e1e24)',
      border: '1px solid var(--dsw-alias-border-l2)',
      borderRadius: '10px', padding: '14px 16px',
      boxShadow: '0 12px 40px rgba(0,0,0,.5)',
    },
    onClick: (e: { stopPropagation(): void }) => e.stopPropagation(),
  },
    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' } },
      h('div', { style: { font: 'var(--dsw-font-s-strong-14)', color: 'var(--dsw-alias-label-primary)' } }, props.title),
      h('button', { style: { border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', fontSize: '16px', cursor: 'pointer' }, onClick: props.onClose }, '✕'),
    ),
    props.children,
  ))
}

/** A monospace output block (diff text / command output). */
export function OutputBlock(props: { text: string; maxHeight?: number }): ReactNode {
  return h('pre', {
    style: {
      margin: 0, padding: '8px 10px',
      background: 'var(--dsw-alias-bg-base)',
      border: '1px solid var(--dsw-alias-border-l1)',
      borderRadius: '6px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: '11px', lineHeight: '1.5',
      color: 'var(--dsw-alias-label-primary)',
      overflow: 'auto', whiteSpace: 'pre',
      maxHeight: props.maxHeight !== undefined ? `${props.maxHeight}px` : undefined,
    },
  }, props.text)
}

/** A status/error line. */
export function StatusLine(props: { text: string; error?: boolean; success?: boolean }): ReactNode {
  const color = props.error === true
    ? 'var(--dsw-alias-state-error-primary)'
    : props.success === true
      ? 'var(--dsw-alias-state-success-primary)'
      : 'var(--dsw-alias-label-tertiary)'
  return h('div', {
    style: {
      font: 'var(--dsw-font-xxs-12)', lineHeight: '18px', padding: '4px 2px',
      color,
      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    },
  }, props.text)
}

/** The panel root wrapper (fills the sidebar tab). */
export function Panel(props: { children?: ReactNode }): ReactNode {
  return h('div', {
    style: {
      display: 'flex', flexDirection: 'column', height: '100%',
      boxSizing: 'border-box', padding: '8px', gap: '8px',
      overflow: 'hidden',
    },
  }, props.children)
}

/** A scrollable content region. */
export function Scroll(props: { children?: ReactNode; flex?: boolean }): ReactNode {
  return h('div', {
    style: {
      flex: props.flex === true ? '1 1 auto' : '0 0 auto',
      overflow: 'auto', minHeight: '0',
    },
  }, props.children)
}

/** Toolbar row. */
export function Toolbar(props: { children?: ReactNode }): ReactNode {
  return h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } }, props.children)
}

/** A Git-panel style section header: chevron + uppercase title + count +
 *  trailing link. Clicking the title collapses/expands the section. */
export function SectionHeader(props: {
  title: string
  count?: number
  actionLabel?: string
  onAction?: () => void
  disabled?: boolean
  /** When true the section body is hidden; the title toggles it. */
  collapsed?: boolean
  onToggle?: () => void
  /** Tooltip texts for the toggle button (i18n); default zh. */
  titleExpand?: string
  titleCollapse?: string
}): ReactNode {
  const titleExpand = props.titleExpand ?? '展开'
  const titleCollapse = props.titleCollapse ?? '折叠'
  const title = h('button', {
    type: 'button',
    style: {
      flex: '1', minWidth: '0', display: 'flex', alignItems: 'center', gap: '4px',
      border: 'none', background: 'transparent', padding: '0', cursor: 'pointer',
      font: 'var(--dsw-font-xxxs-strong-11)',
      color: 'var(--dsw-alias-label-tertiary)',
      textTransform: 'uppercase', textAlign: 'left',
    },
    onClick: props.onToggle,
    title: props.collapsed === true ? titleExpand : titleCollapse,
  },
    h('span', {
      style: {
        flex: 'none', display: 'inline-block', width: '10px', height: '10px',
        lineHeight: '10px', fontSize: '8px',
        transform: props.collapsed === true ? 'rotate(-90deg)' : 'rotate(0deg)',
        transition: 'transform .12s ease',
      },
    }, '▼'),
    h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
      props.title + (props.count !== undefined ? ` (${props.count})` : '')),
  )
  return h('div', {
    style: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px',
      padding: '6px 12px 4px',
    },
  },
    title,
    props.actionLabel !== undefined && h(Btn, { kind: 'link', onClick: props.onAction, disabled: props.disabled }, props.actionLabel),
  )
}
