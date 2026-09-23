import { describe, expect, it } from 'vitest'
import {
  BUILT_IN_THEMES,
  CSS_VARS,
  MIDNIGHT,
  normalizeColor,
  resolveTheme,
  sanitizeTheme,
  serializeTheme,
  THEME_KEYS,
} from '../src/shared/theme'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The colours the stylesheet sets on :root, which must stay what Midnight is. */
function stylesheetRoot(): Record<string, string> {
  const css = readFileSync(join(__dirname, '../src/renderer/src/styles.css'), 'utf8')
  const root = css.slice(css.indexOf(':root {'), css.indexOf('\n}', css.indexOf(':root {')))
  const vars: Record<string, string> = {}
  for (const match of root.matchAll(/(--[a-z-]+):\s*([^;]+);/g)) vars[match[1]!] = match[2]!.trim()
  return vars
}

describe('themes', () => {
  it('resolves an empty theme to exactly the stylesheet defaults', () => {
    const { vars } = resolveTheme(MIDNIGHT)
    const css = stylesheetRoot()
    for (const [name, value] of Object.entries(vars)) {
      const declared = css[name]
      expect(declared, name).toBeDefined()
      // var() chains are fallbacks for readers; only literal colours can be compared.
      if (declared && !declared.startsWith('var(')) expect(normalizeColor(declared), name).toBe(value)
    }
  })

  it('writes every key to a variable', () => {
    for (const key of THEME_KEYS) expect(CSS_VARS[key], key).toBeDefined()
  })

  it('leaves Midnight alone except for what a theme changes', () => {
    const midnight = resolveTheme(MIDNIGHT).colors
    const green = resolveTheme({ name: 'Green', type: 'dark', colors: { accent: '#22cc88' } }).colors
    expect(green.accent).toBe('#22cc88')
    expect(green['panel.background']).toBe(midnight['panel.background'])
    expect(green['accent.foreground']).toBe('#000000')
  })

  it('derives the rest from the base colours', () => {
    const { colors } = resolveTheme({
      name: 'Sea',
      type: 'dark',
      colors: { background: '#001018', foreground: '#d0f0ff' },
    })
    expect(colors['panel.background']).not.toBe(resolveTheme(MIDNIGHT).colors['panel.background'])
    expect(colors['sidebar.background']).toBe(colors['panel.background'])
    expect(colors['input.foreground']).toBe('#d0f0ff')
  })

  it('skips what it cannot read, and keeps the rest', () => {
    const read = sanitizeTheme({
      name: 'Typo',
      type: 'light',
      colors: { accent: '#12345', background: 'rgb(250, 250, 250)', nonsense: '#fff' },
    })
    expect(read?.theme.type).toBe('light')
    expect(read?.theme.colors).toEqual({ background: '#fafafa' })
    expect(read?.skipped).toHaveLength(2)
    expect(sanitizeTheme('not a theme')).toBeNull()
  })

  it('reads the colour formats people write', () => {
    expect(normalizeColor('#abc')).toBe('#aabbcc')
    expect(normalizeColor('#AABBCC80')).toBe('#aabbcc80')
    expect(normalizeColor('rgba(6, 6, 9, 0.97)')).toBe('#060609f7')
    expect(normalizeColor('rgb(10 20 30 / 50%)')).toBe('#0a141e80')
    expect(normalizeColor('red')).toBeNull()
  })

  it('round-trips every built-in theme through its file format', () => {
    for (const theme of BUILT_IN_THEMES) {
      expect(sanitizeTheme(JSON.parse(serializeTheme(theme)))?.theme).toEqual(theme)
    }
  })
})
