/**
 * Where themes live, and keeping every window in step with them.
 *
 * Everything is plain JSON in the app's data folder, which updates never touch:
 *
 *   goonlib_theme.json   the mode, and the whole theme for each side of it
 *   themes/*.json        saved themes, one per file — also what Export writes
 *
 * The active themes are copies rather than references to library files, so
 * deleting or renaming a file in themes/ never leaves the app without one.
 * Both are watched: a hand edit shows up in the app as soon as it is saved.
 * A file that cannot be read is reported and otherwise ignored; with none at
 * all, the app is Midnight, as it always was.
 */

import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, watch, type FSWatcher } from 'node:fs'
import { readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, nativeTheme, shell } from 'electron'
import type { ThemeLibraryEntry, ThemeState } from '@shared/types'
import {
  activeTheme,
  BUILT_IN_THEMES,
  resolveTheme,
  DEFAULT_THEME_CONFIG,
  sanitizeTheme,
  serializeTheme,
  type Theme,
  type ThemeConfig,
  type ThemeMode,
  type ThemeType,
} from '@shared/theme'

const CONFIG_NAME = 'goonlib_theme.json'

function configPath(): string {
  return join(app.getPath('userData'), CONFIG_NAME)
}

function libraryDir(): string {
  return join(app.getPath('userData'), 'themes')
}

/** A file name from a theme's name: "Rosé at night" → "rose-at-night". */
function slug(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'theme'
}

/** Writes via a temporary file, so a watcher never reads half a theme. */
async function writeAtomic(path: string, content: string): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, content, 'utf8')
  await rename(temp, path)
}

class Themes extends EventEmitter {
  private config: ThemeConfig = DEFAULT_THEME_CONFIG
  private library: ThemeLibraryEntry[] = []
  private problems: string[] = []
  private watchers: FSWatcher[] = []
  private reloadTimer: NodeJS.Timeout | null = null

  async init(): Promise<void> {
    mkdirSync(libraryDir(), { recursive: true })
    await this.reload()
    this.watch()
  }

  state(): ThemeState {
    return {
      config: this.config,
      library: this.library,
      folder: libraryDir(),
      problems: this.problems,
    }
  }

  async setMode(mode: ThemeMode): Promise<ThemeState> {
    const clean: ThemeMode = mode === 'light' || mode === 'system' ? mode : 'dark'
    return this.writeConfig({ ...this.config, mode: clean })
  }

  /** Makes a theme the one for one side, without adding it to the library. */
  async use(side: ThemeType, theme: Theme): Promise<ThemeState> {
    const clean = sanitizeTheme(theme)
    if (!clean) throw new Error('That is not a theme.')
    return this.writeConfig({ ...this.config, [side]: clean.theme })
  }

  /**
   * Saves a theme to the library under its name, and makes it the one for
   * `side`. Saving under a name already taken replaces that theme — which is
   * what saving an edit to it should do.
   */
  async save(side: ThemeType, theme: Theme): Promise<ThemeState> {
    const clean = sanitizeTheme(theme)
    if (!clean) throw new Error('That is not a theme.')
    const named = clean.theme
    if (BUILT_IN_THEMES.some((t) => t.name.toLowerCase() === named.name.toLowerCase())) {
      throw new Error(`“${named.name}” is a built-in theme. Give yours another name.`)
    }
    await writeAtomic(join(libraryDir(), `${slug(named.name)}.json`), serializeTheme(named))
    this.config = { ...this.config, [side]: named }
    await writeAtomic(configPath(), this.serializeConfig())
    await this.reload()
    this.emit('change', this.state())
    return this.state()
  }

/**
   * Puts back themes from a settings backup: the saved ones are written into
   * the folder, and the modes and sides are taken as they were. Themes already
   * here under other names are left alone — a restore adds, it does not sweep.
   */
  async restore(config: unknown, library: unknown[]): Promise<ThemeState> {
    for (const entry of library) {
      const clean = sanitizeTheme(entry)
      if (!clean) continue
      if (BUILT_IN_THEMES.some((t) => t.name.toLowerCase() === clean.theme.name.toLowerCase())) continue
      await writeAtomic(join(libraryDir(), `${slug(clean.theme.name)}.json`), serializeTheme(clean.theme))
    }

    const raw = config && typeof config === 'object' ? (config as Record<string, unknown>) : {}
    const side = (key: ThemeType): Theme => sanitizeTheme(raw[key])?.theme ?? this.config[key]
    const mode: ThemeMode = raw.mode === 'light' || raw.mode === 'system' ? raw.mode : 'dark'

    this.config = { mode, dark: side('dark'), light: side('light') }
    this.applyNative()
    await writeAtomic(configPath(), this.serializeConfig())
    await this.reload()
    this.emit('change', this.state())
    return this.state()
  }

  /** Moves a saved theme to the system Trash. Built-ins have no file to remove. */
  async remove(id: string): Promise<ThemeState> {
    const entry = this.library.find((e) => e.id === id && !e.builtIn)
    if (entry) await shell.trashItem(join(libraryDir(), entry.id))
    await this.reload()
    this.emit('change', this.state())
    return this.state()
  }

  /** Asks for a theme file, copies it into the library, and returns what was read. */
  async import(window: BrowserWindow | null): Promise<{ state: ThemeState; theme: Theme | null; skipped: string[] }> {
    const options: Electron.OpenDialogOptions = {
      title: 'Import a theme',
      filters: [{ name: 'Theme', extensions: ['json'] }],
      properties: ['openFile'],
    }
    const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    const file = picked.filePaths[0]
    if (picked.canceled || !file) return { state: this.state(), theme: null, skipped: [] }

    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(file, 'utf8'))
    } catch {
      throw new Error('That file is not valid JSON.')
    }
    const clean = sanitizeTheme(parsed)
    if (!clean) throw new Error('That file is not a theme.')

    let theme = clean.theme
    if (BUILT_IN_THEMES.some((t) => t.name.toLowerCase() === theme.name.toLowerCase())) {
      theme = { ...theme, name: `${theme.name} (imported)` }
    }
    await writeAtomic(join(libraryDir(), `${slug(theme.name)}.json`), serializeTheme(theme))
    await this.reload()
    this.emit('change', this.state())
    return { state: this.state(), theme, skipped: clean.skipped }
  }

  /** Asks where to write a theme, then writes it. Resolves false if cancelled. */
  async export(window: BrowserWindow | null, theme: Theme): Promise<boolean> {
    const clean = sanitizeTheme(theme)
    if (!clean) throw new Error('That is not a theme.')
    const options: Electron.SaveDialogOptions = {
      title: 'Export theme',
      defaultPath: join(app.getPath('documents'), `${slug(clean.theme.name)}.json`),
      filters: [{ name: 'Theme', extensions: ['json'] }],
    }
    const picked = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
    if (picked.canceled || !picked.filePath) return false
    await writeFile(picked.filePath, serializeTheme(clean.theme), 'utf8')
    return true
  }

  /** The window's colour before the page has painted, so opening never flashes. */
  windowBackground(): string {
    const { colors } = resolveTheme(activeTheme(this.config, nativeTheme.shouldUseDarkColors))
    return (colors.background ?? '#0b0b0f').slice(0, 7)
  }

  /**
   * The host's themes as CSS for the guest page, which uses the same variable
   * names. Following the system there means the guest's system, not the host's.
   */
  guestCss(): string {
    const block = (theme: Theme): string => {
      const { vars, type } = resolveTheme(theme)
      const lines = Object.entries(vars).map(([name, value]) => `${name}: ${value};`)
      return `:root { color-scheme: ${type}; ${lines.join(' ')} }`
    }
    const { mode, dark, light } = this.config
    if (mode !== 'system') return block(this.config[mode])
    return `${block(dark)}\n@media (prefers-color-scheme: light) { ${block(light)} }`
  }

  revealFolder(): void {
    void shell.openPath(libraryDir())
  }

  private async writeConfig(next: ThemeConfig): Promise<ThemeState> {
    this.config = next
    this.applyNative()
    await writeAtomic(configPath(), this.serializeConfig())
    this.emit('change', this.state())
    return this.state()
  }

  private serializeConfig(): string {
    const theme = (t: Theme): unknown => JSON.parse(serializeTheme(t))
    return (
      JSON.stringify({ mode: this.config.mode, dark: theme(this.config.dark), light: theme(this.config.light) }, null, 2) +
      '\n'
    )
  }

  private async reload(): Promise<void> {
    const problems: string[] = []
    this.config = await readConfig(problems)
    this.library = [
      ...BUILT_IN_THEMES.map((theme) => ({ id: `builtin:${slug(theme.name)}`, theme, builtIn: true })),
      ...(await readLibrary(problems)),
    ]
    this.problems = problems
    this.applyNative()
  }

  /**
   * Tells Chromium and macOS which side is showing: this is what the page's
   * prefers-color-scheme follows, and what colours the window's own chrome.
   */
  private applyNative(): void {
    nativeTheme.themeSource = this.config.mode
  }

  private watch(): void {
    const onChange = (_event: string, file: string | Buffer | null): void => {
      const name = file ? String(file) : ''
      if (name.endsWith('.tmp')) return
      if (this.reloadTimer) clearTimeout(this.reloadTimer)
      this.reloadTimer = setTimeout(() => {
        this.reloadTimer = null
        void this.reload().then(() => this.emit('change', this.state()))
      }, 150)
    }
    try {
      // The folder rather than the file: editors save by replacing the file,
      // which a watch on the file itself would lose track of.
      this.watchers.push(
        watch(app.getPath('userData'), (event, file) => {
          if (file && String(file) === CONFIG_NAME) onChange(event, file)
        }),
      )
      this.watchers.push(watch(libraryDir(), onChange))
    } catch (err) {
      console.error('[theme] cannot watch for edits:', err)
    }
  }

  close(): void {
    for (const watcher of this.watchers) watcher.close()
    this.watchers = []
  }
}

async function readConfig(problems: string[]): Promise<ThemeConfig> {
  const path = configPath()
  if (!existsSync(path)) return DEFAULT_THEME_CONFIG
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(await readFile(path, 'utf8'))
    if (!raw || typeof raw !== 'object') throw new Error('not an object')
  } catch {
    problems.push(`${CONFIG_NAME} could not be read, so the default themes are showing.`)
    return DEFAULT_THEME_CONFIG
  }
  const side = (key: ThemeType): Theme => {
    if (raw[key] === undefined) return DEFAULT_THEME_CONFIG[key]
    const clean = sanitizeTheme(raw[key])
    if (!clean) {
      problems.push(`The ${key} theme in ${CONFIG_NAME} could not be read.`)
      return DEFAULT_THEME_CONFIG[key]
    }
    for (const skip of clean.skipped) problems.push(`${CONFIG_NAME}, ${key} theme: skipped ${skip}`)
    return clean.theme
  }
  const mode: ThemeMode = raw.mode === 'light' || raw.mode === 'system' ? raw.mode : 'dark'
  return { mode, dark: side('dark'), light: side('light') }
}

async function readLibrary(problems: string[]): Promise<ThemeLibraryEntry[]> {
  let files: string[]
  try {
    files = (await readdir(libraryDir())).filter((f) => f.toLowerCase().endsWith('.json')).sort()
  } catch {
    return []
  }
  const entries: ThemeLibraryEntry[] = []
  for (const file of files) {
    try {
      const clean = sanitizeTheme(JSON.parse(await readFile(join(libraryDir(), file), 'utf8')))
      if (!clean) throw new Error('not a theme')
      for (const skip of clean.skipped) problems.push(`${file}: skipped ${skip}`)
      entries.push({ id: file, theme: clean.theme, builtIn: false })
    } catch {
      problems.push(`${file} could not be read as a theme.`)
    }
  }
  return entries
}

export const themes = new Themes()
