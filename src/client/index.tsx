/**
 * dsh-svn-plugin client half: registers the "SVN" tab into the
 * dsh-better-sidebar service (`ctx.betterSidebar.registerTab`) and attaches
 * the zh/en dictionaries to the DSH locale service. The tab renders the full
 * SVN panel (status / history / shelve / repo browser / branch / props /
 * changelist / agent tools).
 *
 * The tab descriptor uses a namespaced id `dsh-svn` so it can never collide
 * with another plugin's tab, and `single: true` so only one SVN tab exists
 * per session.
 */
import { createElement as h } from 'react'
import type { Context, TabDescriptor } from 'dsh-better-sidebar'
import { zh, en } from './locales.ts'
import { SvnView } from './SvnView.tsx'
import type { Dict } from './ui.tsx'

/** Plugin identity (client half). */
export const name = 'dsh-svn-plugin'

/** Services required before mounting. */
export const inject = ['betterSidebar', 'locale']

/** Locale namespace of this plugin. */
export const LOCALE_NS = 'dsh-svn'

/** The svn tab icon (a stylized "stacked revisions" mark; inline SVG). */
function SvnIcon(props: { size?: number }): React.ReactNode {
  const size = props.size ?? 16
  return h('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
  },
    h('circle', { cx: '7', cy: '12', r: '3' }),
    h('path', { d: 'M10 12h9' }),
    h('path', { d: 'M10 6h6' }),
    h('path', { d: 'M10 18h7' }),
  )
}

/**
 * Client plugin body.
 * @param ctx - the client cordis context (betterSidebar registry, locale).
 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    // i18n: register both dictionaries under our namespace and follow the
    // Host-backed active locale.
    const disposers: Array<() => void> = []
    const localeState = { active: 'zh' }
    try {
      localeState.active = ctx.locale.getSnapshot().active
    } catch { /* locale service optional */ }
    disposers.push(ctx.locale.subscribe(() => {
      try {
        localeState.active = ctx.locale.getSnapshot().active
      } catch { /* keep last */ }
    }))

    const t = (key: string): string => {
      const active = localeState.active
      const dict: Dict = active === 'en' ? en : zh
      return dict[key] ?? key
    }

    // Register the SVN tab into the better-sidebar service. The disposer
    // unregisters on fiber disposal (HMR-safe).
    const offZh = ctx.locale.register(LOCALE_NS, 'zh', zh)
    const offEn = ctx.locale.register(LOCALE_NS, 'en', en)
    disposers.push(offZh, offEn)

    const tab: TabDescriptor = {
      id: 'dsh-svn',
      title: () => t('svn'),
      icon: (size: number) => h(SvnIcon, { size }),
      order: 60,
      single: true,
      // The panel publishes its change count through a DOM data attribute on
      // its root; the badge reads it cheaply on every tab-bar render.
      badge: () => {
        try {
          const el = document.querySelector('[data-dsh-svn-count]')
          const count = el?.getAttribute('data-dsh-svn-count')
          const n = Number(count)
          return Number.isFinite(n) && n > 0 ? n : undefined
        } catch {
          return undefined
        }
      },
      component: (props) => h(SvnView, {
        ctx: props.ctx,
        scope: props.scope,
        t,
        visible: props.visible,
      }),
    }
    disposers.push(ctx.betterSidebar.registerTab(tab))
    return () => {
      for (const d of disposers) {
        try { d() } catch { /* already disposed */ }
      }
    }
  }, 'dsh-svn-plugin: tab + dictionaries')
}
