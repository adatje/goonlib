/**
 * Settings and themes, out to a file and back in.
 *
 * Deliberately only settings and themes: a library's filing is about that
 * machine's own files, and matching tags and collections onto another
 * machine's copies is a guessing game with no good answer. Preferences and
 * themes have no such problem — they are yours, not your files'.
 *
 * The API key is never written out. It is held by the OS keychain where there
 * is one, and a plain-text copy of it in a file people mail around is exactly
 * what that is for avoiding.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import type { SettingsBackup } from '@shared/types'
import { SETTING_AI_KEY } from './db/settings'
import { getDb } from './db'
import { themes } from './theme'

/** Bumped if the shape ever changes in a way an older app could not read. */
const FORMAT = 1

/** What an export is called, and what an import will accept. */
const KIND = 'goonlib-settings'

export async function exportSettings(window: BrowserWindow | null): Promise<boolean> {
  const picked = await save(window)
  if (!picked) return false

  const backup: SettingsBackup = {
    kind: KIND,
    format: FORMAT,
    version: app.getVersion(),
    exportedAt: Date.now(),
    settings: rows(),
    themes: themes.state().config,
    library: themes
      .state()
      .library.filter((entry) => !entry.builtIn)
      .map((entry) => entry.theme),
  }

  await writeFile(picked, JSON.stringify(backup, null, 2) + '\n', 'utf8')
  return true
}

/**
 * Reads a file and, once the person has said so, puts it back. Everything it
 * carries replaces what is here; anything it does not carry is left alone.
 */
export async function importSettings(window: BrowserWindow | null): Promise<boolean> {
  const picked = await open(window)
  if (!picked) return false

  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(picked, 'utf8'))
  } catch {
    throw new Error('That file is not valid JSON.')
  }

  const backup = parsed as Partial<SettingsBackup>
  if (!backup || backup.kind !== KIND) throw new Error('That file is not a GoonLib settings backup.')
  if (typeof backup.format !== 'number' || backup.format > FORMAT) {
    throw new Error('That backup was written by a newer version of GoonLib.')
  }

  const settings = backup.settings && typeof backup.settings === 'object' ? backup.settings : {}
  const themeCount = Array.isArray(backup.library) ? backup.library.length : 0
  const question: Electron.MessageBoxOptions = {
    type: 'warning',
    buttons: ['Restore', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: 'Restore these settings?',
    detail:
      `${Object.keys(settings).length} settings and ${themeCount} ${themeCount === 1 ? 'theme' : 'themes'} ` +
      'from this file replace what is set here. Your library, its filing and your files are untouched. ' +
      'The AI key is never part of a backup, so yours stays as it is.',
  }
  const answer = window
    ? await dialog.showMessageBox(window, question)
    : await dialog.showMessageBox(question)
  if (answer.response !== 0) return false

  apply(settings)
  await themes.restore(backup.themes, Array.isArray(backup.library) ? backup.library : [])
  return true
}

/** Every stored setting, less the one that is a secret. */
function rows(): Record<string, string> {
  const all = getDb()
    .prepare<[], { key: string; value: string }>('SELECT key, value FROM settings')
    .all()

  const out: Record<string, string> = {}
  for (const row of all) {
    if (row.key === SETTING_AI_KEY) continue
    out[row.key] = row.value
  }
  return out
}

/**
 * Writes them back as they came. Every reader of this table shapes what it
 * finds — a bad number becomes the default rather than breaking anything — so
 * a backup from an older version is safe to put back.
 */
function apply(settings: Record<string, unknown>): void {
  const db = getDb()
  const write = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  )

  const writeAll = db.transaction((entries: Array<[string, string]>) => {
    for (const [key, value] of entries) write.run(key, value)
  })

  writeAll(
    Object.entries(settings)
      .filter(([key, value]) => key !== SETTING_AI_KEY && typeof value === 'string')
      .map(([key, value]) => [key, value as string]),
  )
}

async function save(window: BrowserWindow | null): Promise<string | null> {
  const stamp = new Date().toISOString().slice(0, 10)
  const options: Electron.SaveDialogOptions = {
    title: 'Export settings',
    defaultPath: join(app.getPath('documents'), `goonlib-settings-${stamp}.json`),
    filters: [{ name: 'GoonLib settings', extensions: ['json'] }],
  }
  const picked = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
  return picked.canceled || !picked.filePath ? null : picked.filePath
}

async function open(window: BrowserWindow | null): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: 'Import settings',
    filters: [{ name: 'GoonLib settings', extensions: ['json'] }],
    properties: ['openFile'],
  }
  const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
  return picked.canceled ? null : (picked.filePaths[0] ?? null)
}
