/**
 * Colour themes.
 *
 * A theme file is modelled on VS Code's: a name, whether it is dark or light,
 * and a flat map of dotted colour keys. Every key is optional. The three base
 * keys — background, foreground and accent — are where every other colour
 * comes from when a theme leaves it out, so a hand-written theme can be three
 * lines long and still cover the whole app, and an empty one is Midnight.
 *
 * This module is shared: the app's window and the guest page both resolve a
 * theme into CSS custom properties with it, so a theme looks the same in both.
 */

export type ThemeType = 'dark' | 'light'
export type ThemeMode = ThemeType | 'system'

export const THEME_KEYS = [
  'background',
  'foreground',
  'accent',
  'foreground.muted',
  'accent.foreground',
  'panel.background',
  'panel.border',
  'sidebar.background',
  'sidebar.foreground',
  'sidebar.activeBackground',
  'toolbar.background',
  'list.hoverBackground',
  'list.activeBackground',
  'input.background',
  'input.border',
  'input.foreground',
  'button.background',
  'button.foreground',
  'button.hoverBackground',
  'card.background',
  'viewer.background',
  'player.controlsBackground',
  'danger',
  'success',
  'favorite',
  'icon.foreground',
] as const

export type ThemeKey = (typeof THEME_KEYS)[number]

export interface Theme {
  name: string
  type: ThemeType
  colors: Partial<Record<ThemeKey, string>>
}

/** What goonlib_theme.json holds: the mode, and the theme for each side of it. */
export interface ThemeConfig {
  mode: ThemeMode
  dark: Theme
  light: Theme
}

/** How the App Styling page groups and explains the keys. */
export const THEME_GROUPS: Array<{ title: string; keys: Array<{ key: ThemeKey; label: string }> }> = [
  {
    title: 'Base',
    keys: [
      { key: 'background', label: 'Background' },
      { key: 'foreground', label: 'Text' },
      { key: 'accent', label: 'Accent' },
    ],
  },
  {
    title: 'Text and accent',
    keys: [
      { key: 'foreground.muted', label: 'Secondary text' },
      { key: 'accent.foreground', label: 'Text on accent' },
      { key: 'icon.foreground', label: 'Icons' },
    ],
  },
  {
    title: 'Surfaces',
    keys: [
      { key: 'panel.background', label: 'Panels and menus' },
      { key: 'panel.border', label: 'Borders' },
    ],
  },
  {
    title: 'Sidebar',
    keys: [
      { key: 'sidebar.background', label: 'Background' },
      { key: 'sidebar.foreground', label: 'Text' },
      { key: 'sidebar.activeBackground', label: 'Selected entry' },
    ],
  },
  { title: 'Toolbar', keys: [{ key: 'toolbar.background', label: 'Background' }] },
  {
    title: 'Lists',
    keys: [
      { key: 'list.hoverBackground', label: 'Under the pointer' },
      { key: 'list.activeBackground', label: 'Selected' },
    ],
  },
  {
    title: 'Inputs',
    keys: [
      { key: 'input.background', label: 'Background' },
      { key: 'input.border', label: 'Border' },
      { key: 'input.foreground', label: 'Text' },
    ],
  },
  {
    title: 'Buttons',
    keys: [
      { key: 'button.background', label: 'Background' },
      { key: 'button.foreground', label: 'Text' },
      { key: 'button.hoverBackground', label: 'Under the pointer' },
    ],
  },
  {
    title: 'Media',
    keys: [
      { key: 'card.background', label: 'Behind thumbnails' },
      { key: 'viewer.background', label: 'Behind an open item' },
      { key: 'player.controlsBackground', label: 'Player controls' },
    ],
  },
  {
    title: 'Status',
    keys: [
      { key: 'danger', label: 'Danger' },
      { key: 'success', label: 'Success' },
      { key: 'favorite', label: 'Favorite' },
    ],
  },
]

// --- colour arithmetic --------------------------------------------------------

interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/**
 * Reads a colour a person might type: #rgb, #rgba, #rrggbb, #rrggbbaa, or
 * rgb()/rgba() with commas or spaces. Anything else is null — the caller
 * skips it rather than failing the whole theme.
 */
export function parseColor(value: unknown): Rgba | null {
  if (typeof value !== 'string') return null
  const text = value.trim().toLowerCase()

  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text)
  if (hex) {
    let digits = hex[1] ?? ''
    if (digits.length <= 4) digits = [...digits].map((d) => d + d).join('')
    const n = (i: number): number => parseInt(digits.slice(i, i + 2), 16)
    return { r: n(0), g: n(2), b: n(4), a: digits.length === 8 ? n(6) / 255 : 1 }
  }

  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(text)
  if (fn) {
    const [, r = '', g = '', b = '', alpha] = fn
    const channel = (s: string): number => Math.min(255, Math.max(0, Math.round(Number(s))))
    let a = 1
    if (alpha !== undefined) {
      a = alpha.endsWith('%') ? Number(alpha.slice(0, -1)) / 100 : Number(alpha)
    }
    if (![r, g, b].every((s) => Number.isFinite(Number(s))) || !Number.isFinite(a)) return null
    return { r: channel(r), g: channel(g), b: channel(b), a: Math.min(1, Math.max(0, a)) }
  }
  return null
}

/** #rrggbb, or #rrggbbaa when it is not opaque. */
export function formatColor(c: Rgba): string {
  const h = (n: number): string => Math.round(n).toString(16).padStart(2, '0')
  const base = `#${h(c.r)}${h(c.g)}${h(c.b)}`
  return c.a >= 1 ? base : base + h(c.a * 255)
}

/** Reformats a colour the way formatColor writes it, or null when unreadable. */
export function normalizeColor(value: unknown): string | null {
  const c = parseColor(value)
  return c ? formatColor(c) : null
}

/** `a` moved toward `b` by `t` (0–1), alpha included. */
function mix(a: Rgba, b: Rgba, t: number): Rgba {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t,
  }
}

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 }
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 }

function luminance(c: Rgba): number {
  const lin = (v: number): number => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}

// --- resolving ----------------------------------------------------------------

/**
 * Every colour the stylesheet reads, as Midnight has it. The first 25 are the
 * theme keys; the rest are tints the app needs that no theme sets directly.
 */
const MIDNIGHT_VALUES: Record<string, string> = {
  background: '#0b0b0f',
  foreground: '#e7e7ee',
  accent: '#7c6cff',
  'foreground.muted': '#8b8b9c',
  'accent.foreground': '#ffffff',
  'panel.background': '#14141a',
  'panel.border': '#26262f',
  'sidebar.background': '#14141a',
  'sidebar.foreground': '#e7e7ee',
  'sidebar.activeBackground': '#ff5c8a2e',
  'toolbar.background': '#0b0b0f',
  // Rows, menu items and tabs are tinted with the favourite pink.
  'list.hoverBackground': '#ff5c8a17',
  'list.activeBackground': '#ff5c8a2e',
  'input.background': '#08080b',
  'input.border': '#26262f',
  'input.foreground': '#e7e7ee',
  'button.background': '#1d1d26',
  'button.foreground': '#e7e7ee',
  'button.hoverBackground': '#26262f',
  'card.background': '#14141a',
  'viewer.background': 'rgba(6, 6, 9, 0.97)',
  'player.controlsBackground': '#14141a',
  danger: '#ff6b6b',
  success: '#62d29a',
  favorite: '#ff5c8a',
  'icon.foreground': '#ff5c8a',
  'x.surface': '#1d1d26',
  'x.listActiveHover': '#ff5c8a38',
  'x.dangerText': '#ffb4b4',
  'x.accentText': '#c3b9ff',
  'x.warn': '#f0b23c',
  'x.warnText': '#f0c069',
  'x.warnTextSoft': '#ffcf8b',
  'x.live': '#4ad07a',
  'x.barBase': '#0e0e14',
}

/** The CSS custom property each colour is written to. */
export const CSS_VARS: Record<string, string> = {
  background: '--bg',
  foreground: '--text',
  accent: '--accent',
  'foreground.muted': '--text-muted',
  'accent.foreground': '--accent-fg',
  'panel.background': '--bg-raised',
  'panel.border': '--border',
  'sidebar.background': '--sidebar-bg',
  'sidebar.foreground': '--sidebar-fg',
  'sidebar.activeBackground': '--sidebar-active',
  'toolbar.background': '--toolbar-bg',
  'list.hoverBackground': '--list-hover',
  'list.activeBackground': '--list-active',
  'input.background': '--bg-sunken',
  'input.border': '--input-border',
  'input.foreground': '--input-fg',
  'button.background': '--button-bg',
  'button.foreground': '--button-fg',
  'button.hoverBackground': '--button-hover',
  'card.background': '--card-bg',
  'viewer.background': '--viewer-bg',
  'player.controlsBackground': '--controls-bg',
  danger: '--danger',
  success: '--success',
  favorite: '--heart',
  'icon.foreground': '--icon',
  'x.surface': '--bg-hover',
  'x.listActiveHover': '--list-active-hover',
  'x.dangerText': '--danger-text',
  'x.accentText': '--accent-text',
  'x.warn': '--warn',
  'x.warnText': '--warn-text',
  'x.warnTextSoft': '--warn-text-soft',
  'x.live': '--live',
  'x.barBase': '--bar-base',
}

type Get = (key: string) => Rgba

interface Rule {
  /** The colours this one is worked out from. */
  from: string[]
  derive: (get: Get, type: ThemeType) => Rgba
}

/**
 * How each colour is worked out when a theme leaves it out.
 *
 * "Lifting" moves a colour toward the text colour, which makes it lighter on a
 * dark theme and darker on a light one — so the same rule suits both. The
 * amounts are the ones that land on Midnight's own colours.
 */
const RULES: Record<string, Rule> = {
  'foreground.muted': { from: ['foreground', 'background'], derive: (g) => mix(g('foreground'), g('background'), 0.42) },
  'accent.foreground': {
    from: ['accent'],
    derive: (g) => (luminance(g('accent')) > 0.45 ? BLACK : WHITE),
  },
  'panel.background': { from: ['background', 'foreground'], derive: (g) => mix(g('background'), g('foreground'), 0.04) },
  'panel.border': { from: ['background', 'foreground'], derive: (g) => mix(g('background'), g('foreground'), 0.12) },
  'sidebar.background': { from: ['panel.background'], derive: (g) => g('panel.background') },
  'sidebar.foreground': { from: ['foreground'], derive: (g) => g('foreground') },
  'sidebar.activeBackground': { from: ['list.activeBackground'], derive: (g) => g('list.activeBackground') },
  'toolbar.background': { from: ['background'], derive: (g) => g('background') },
  // Pointed-at and selected rows are the favourite colour, faint and fainter.
  'list.hoverBackground': { from: ['favorite'], derive: (g) => ({ ...g('favorite'), a: 0.09 }) },
  'list.activeBackground': { from: ['favorite'], derive: (g) => ({ ...g('favorite'), a: 0.18 }) },
  'icon.foreground': { from: ['favorite'], derive: (g) => g('favorite') },
  // The neutral raised surface that buttons, tracks and meters sit on.
  'x.surface': { from: ['background', 'foreground'], derive: (g) => mix(g('background'), g('foreground'), 0.08) },
  // A selected row under the pointer: a little deeper than selected alone.
  'x.listActiveHover': {
    from: ['list.activeBackground', 'foreground'],
    derive: (g) => {
      const active = g('list.activeBackground')
      return active.a < 1 ? { ...active, a: Math.min(1, active.a * 1.22) } : mix(active, g('foreground'), 0.05)
    },
  },
  'input.background': {
    from: ['background'],
    // Wells sink on a dark theme; on a light one they turn toward white.
    derive: (g, type) => (type === 'light' ? mix(g('background'), WHITE, 0.7) : mix(g('background'), BLACK, 0.27)),
  },
  'input.border': { from: ['panel.border'], derive: (g) => g('panel.border') },
  'input.foreground': { from: ['foreground'], derive: (g) => g('foreground') },
  'button.background': { from: ['x.surface'], derive: (g) => g('x.surface') },
  'button.foreground': { from: ['foreground'], derive: (g) => g('foreground') },
  'button.hoverBackground': {
    from: ['button.background', 'foreground'],
    derive: (g) => mix(g('button.background'), g('foreground'), 0.05),
  },
  'card.background': { from: ['panel.background'], derive: (g) => g('panel.background') },
  'viewer.background': {
    from: ['background'],
    derive: (g, type) => ({
      ...(type === 'light' ? mix(g('background'), BLACK, 0.04) : mix(g('background'), BLACK, 0.45)),
      a: 0.97,
    }),
  },
  'player.controlsBackground': { from: ['panel.background'], derive: (g) => g('panel.background') },
  'x.dangerText': { from: ['danger', 'foreground'], derive: (g) => mix(g('danger'), g('foreground'), 0.45) },
  'x.accentText': { from: ['accent', 'foreground'], derive: (g) => mix(g('accent'), g('foreground'), 0.5) },
  'x.warn': { from: ['background'], derive: (_g, type) => parseColor(type === 'light' ? '#c0831a' : '#f0b23c') ?? BLACK },
  'x.warnText': { from: ['x.warn', 'foreground'], derive: (g) => mix(g('x.warn'), g('foreground'), 0.25) },
  'x.warnTextSoft': { from: ['x.warn', 'foreground'], derive: (g) => mix(g('x.warn'), g('foreground'), 0.4) },
  'x.live': { from: ['success'], derive: (g) => g('success') },
  'x.barBase': {
    from: ['background', 'panel.background'],
    derive: (g) => mix(g('background'), g('panel.background'), 0.5),
  },
}

const MIDNIGHT_RGBA: Record<string, Rgba> = Object.fromEntries(
  Object.entries(MIDNIGHT_VALUES).map(([k, v]) => [k, parseColor(v) ?? BLACK]),
)

function midnight(key: string): Rgba {
  return MIDNIGHT_RGBA[key] ?? BLACK
}

export interface ResolvedTheme {
  type: ThemeType
  /** Every colour, by theme key (plus the x.* tints), as #rrggbb[aa]. */
  colors: Record<string, string>
  /** The same colours by CSS custom property, ready to set on :root. */
  vars: Record<string, string>
}

/**
 * Works out every colour of a theme. A colour the theme sets is used as is.
 * One it leaves out follows its rule — except that when everything the rule
 * would use is still Midnight's, it is Midnight's own colour, so a theme that
 * changes only the accent leaves the rest of Midnight exactly as it was.
 */
export function resolveTheme(theme: Theme): ResolvedTheme {
  const type: ThemeType = theme.type === 'light' ? 'light' : 'dark'
  const resolved: Record<string, Rgba> = {}
  const set = sanitizeColors(theme.colors).colors

  const get = (key: string): Rgba => {
    const known = resolved[key]
    if (known) return known
    let value: Rgba
    const own = parseColor(set[key as ThemeKey])
    const rule = RULES[key]
    if (own) {
      value = own
    } else if (!rule) {
      value = midnight(key)
    } else {
      const unchanged = type === 'dark' && rule.from.every((parent) => same(get(parent), midnight(parent)))
      value = unchanged ? midnight(key) : rule.derive(get, type)
    }
    resolved[key] = value
    return value
  }

  const colors: Record<string, string> = {}
  const vars: Record<string, string> = {}
  for (const key of Object.keys(MIDNIGHT_VALUES)) {
    const color = formatColor(get(key))
    colors[key] = color
    vars[CSS_VARS[key] ?? `--${key}`] = color
  }
  return { type, colors, vars }
}

function same(a: Rgba, b: Rgba): boolean {
  return formatColor(a) === formatColor(b)
}

/**
 * Keeps the colours that can be read, under keys that exist, and lists what
 * was skipped. Never throws: a theme with one typo still loads.
 */
export function sanitizeColors(colors: unknown): {
  colors: Partial<Record<ThemeKey, string>>
  skipped: string[]
} {
  const out: Partial<Record<ThemeKey, string>> = {}
  const skipped: string[] = []
  if (!colors || typeof colors !== 'object') return { colors: out, skipped }
  for (const [key, value] of Object.entries(colors as Record<string, unknown>)) {
    if (!(THEME_KEYS as readonly string[]).includes(key)) {
      skipped.push(`${key} (not a colour GoonLib knows)`)
      continue
    }
    const color = normalizeColor(value)
    if (!color) {
      skipped.push(`${key} (${JSON.stringify(value)} is not a colour)`)
      continue
    }
    out[key as ThemeKey] = color
  }
  return { colors: out, skipped }
}

/** Reads a theme from parsed JSON, keeping what it can. Null when it is not a theme at all. */
export function sanitizeTheme(value: unknown): { theme: Theme; skipped: string[] } | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.colors !== undefined && (typeof raw.colors !== 'object' || raw.colors === null)) return null
  const { colors, skipped } = sanitizeColors(raw.colors)
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 60) : 'Untitled'
  const type: ThemeType = raw.type === 'light' ? 'light' : 'dark'
  return { theme: { name, type, colors }, skipped }
}

// --- built-in themes ----------------------------------------------------------

export const MIDNIGHT: Theme = { name: 'Midnight', type: 'dark', colors: {} }

export const DAYLIGHT: Theme = {
  name: 'Daylight',
  type: 'light',
  colors: {
    background: '#f5f5f8',
    foreground: '#1c1c24',
    accent: '#6a5af9',
    'foreground.muted': '#6c6c7a',
    'panel.background': '#ffffff',
    'panel.border': '#dcdce4',
    'button.background': '#ebebf1',
    'input.background': '#ffffff',
    'viewer.background': '#eeeef2',
    danger: '#d93a3a',
    success: '#1f9960',
    favorite: '#e0356b',
  },
}

export const BUILT_IN_THEMES: Theme[] = [
  MIDNIGHT,
  {
    name: 'OLED Black',
    type: 'dark',
    colors: {
      background: '#000000',
      'panel.background': '#0b0b0d',
      'panel.border': '#1f1f25',
      'button.background': '#16161b',
      'input.background': '#000000',
      'viewer.background': '#000000',
    },
  },
  {
    name: 'Rosé',
    type: 'dark',
    colors: {
      background: '#17111a',
      foreground: '#f1e6ee',
      accent: '#ff7eb0',
      'foreground.muted': '#a8929f',
      'accent.foreground': '#1b0d14',
      favorite: '#ff9ec4',
    },
  },
  DAYLIGHT,
]

export const DEFAULT_LIGHT: Theme = DAYLIGHT

export const DEFAULT_THEME_CONFIG: ThemeConfig = { mode: 'dark', dark: MIDNIGHT, light: DEFAULT_LIGHT }

/** Picks the theme for the moment: the mode's, or the OS's when following it. */
export function activeTheme(config: ThemeConfig, osPrefersDark: boolean): Theme {
  const side = config.mode === 'system' ? (osPrefersDark ? 'dark' : 'light') : config.mode
  return config[side]
}

/** A theme as it is written to disk: only the keys it sets, in the documented order. */
export function serializeTheme(theme: Theme): string {
  const colors: Record<string, string> = {}
  for (const key of THEME_KEYS) {
    const value = theme.colors[key]
    if (value) colors[key] = value
  }
  return JSON.stringify({ name: theme.name, type: theme.type, colors }, null, 2) + '\n'
}
