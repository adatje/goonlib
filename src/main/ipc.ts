import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, webContents } from 'electron'
import { readdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { IPC } from '@shared/types'
import type { Theme, ThemeMode, ThemeType } from '@shared/theme'
import type {
  AiSettings,
  CoWatchIntent,
  CoWatchReach,
  CoWatchSession,
  CoWatchTunnelProvider,
  AiSettingsView,
  AiTestResult,
  AppInfo,
  Collection,
  DuplicateReport,
  FolderNode,
  LibraryStats,
  MediaAnnotations,
  MediaExif,
  MediaFileAction,
  MediaItem,
  MediaPage,
  MediaViews,
  MediaQuery,
  MoveResult,
  PlaybackPrefs,
  PrepareProgress,
  PreparedMedia,
  Root,
  ScanProgress,
  ScrapeProgress,
  Tag,
  ThemeState,
  CustomPatternDraft,
  ToyManual,
  ToyPlayback,
  ToyPrefs,
  ToyStatus,
} from '@shared/types'
import { listModels, resetClient, testConnection } from './ai/client'
import { cowatch } from './cowatch'
import { dbPath } from './db'
import {
  addToCollection,
  collectionsOf,
  createCollection,
  deleteCollection,
  listCollections,
  moveInCollection,
  removeFromCollection,
  renameCollection,
  setCollectionCover,
} from './db/collections'
import { setFavorite } from './db/favorites'
import { findExactDuplicates, findNearDuplicates } from './db/duplicates'
import { listChildFolders } from './db/folders'
import { listAnnotations, queueForClassification, resetClassification } from './db/labels'
import {
  countPending,
  forgetMedia,
  getMedia,
  listExtensions,
  listMedia,
  listMediaIds,
  relocateMedia,
} from './db/media'
import { containingRoot, moveFile, relPathFor, uniqueName } from './relocate'
import {
  aiReady,
  aiSettings,
  aiSettingsView,
  clearApiKey,
  duplicateDistance,
  playbackPrefs,
  hostName,
  setHostName,
  setAiSettings,
  setApiKey,
  setDuplicateDistance,
  setPlaybackPrefs,
} from './db/settings'
import { createTag, deleteTag, listTags, renameTag, tagMedia, untagMedia } from './db/tags'
import {
  addRoot,
  getMediaLocation,
  libraryStats,
  listRoots,
  removeRoot,
  setRootEnabled,
} from './db/queries'
import { resolveWithinRoot } from './protocol/confine'
import { ffmpegPath, ffprobePath } from './ffmpeg'
import { runFileAction } from './menu'
import { preparer } from './media/prepare'
import { indexer } from './scan/indexer'
import { scraper } from './scrape/scraper'
import { toys } from './toy'
import { exportSettings, importSettings } from './backup'
import { readExif } from './media/exif'
import {
  clearHistory,
  continueWatching,
  forgetPosition,
  positionOf,
  recordPosition,
  recordView,
  viewsOf,
} from './db/views'
import { themes } from './theme'
import { trashHistory } from './trash'
import type { TrashUndoResult } from '@shared/types'

/** Largest page the renderer may ask for, so a bad query can't pull the whole library. */
const MAX_PAGE = 500

export function registerIpc(): void {
  handle(IPC.appInfo, (): AppInfo => appInfo())

  handle(IPC.rootsList, (): Root[] => listRoots())

  handle(IPC.rootsAdd, async (event): Promise<Root | null> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Add a library folder',
      buttonLabel: 'Add to library',
      properties: ['openDirectory', 'createDirectory'],
    }

    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)

    const picked = result.filePaths[0]
    if (result.canceled || !picked) return null

    const root = addRoot(picked)
    // Adding a folder and then having to press "scan" would be a pointless step.
    indexer.start(root.id)
    return root
  })

  handle(IPC.rootsRemove, (_event, id: number): void => removeRoot(id))

  handle(IPC.rootsSetEnabled, (_event, id: number, enabled: boolean): void =>
    setRootEnabled(id, enabled),
  )

  handle(IPC.libraryExtensions, (): Array<{ ext: string; count: number }> => listExtensions())
  handle(IPC.libraryStats, (): LibraryStats => libraryStats())

  handle(IPC.mediaList, (_event, query: MediaQuery): MediaPage =>
    listMedia({
      ...query,
      limit: clamp(query.limit, 1, MAX_PAGE),
      offset: Math.max(0, Math.floor(query.offset)),
    }),
  )

  handle(IPC.mediaGet, (_event, id: number): MediaItem | null => getMedia(id))

  handle(IPC.mediaIds, (_event, query: Omit<MediaQuery, 'limit' | 'offset'>): number[] =>
    listMediaIds(query),
  )

  handle(IPC.foldersChildren, (_event, rootId: number, path: string): FolderNode[] =>
    listChildFolders(rootId, path),
  )

  handle(IPC.collectionsList, (): Collection[] => listCollections())
  handle(IPC.collectionsCreate, (_event, name: string): Collection => createCollection(name))
  handle(IPC.collectionsRename, (_event, id: number, name: string): void =>
    renameCollection(id, name),
  )
  handle(IPC.collectionsDelete, (_event, id: number): void => deleteCollection(id))
  handle(IPC.collectionsAdd, (_event, id: number, mediaIds: number[]): number =>
    addToCollection(id, mediaIds),
  )
  handle(IPC.collectionsRemove, (_event, id: number, mediaIds: number[]): void =>
    removeFromCollection(id, mediaIds),
  )
  handle(IPC.collectionsOf, (_event, mediaId: number): number[] => collectionsOf(Number(mediaId)))
  handle(IPC.collectionsMove, (_event, id: number, mediaId: number, toIndex: number): void =>
    moveInCollection(id, mediaId, toIndex),
  )
  handle(IPC.collectionsSetCover, (_event, id: number, mediaId: number | null): void =>
    setCollectionCover(id, mediaId),
  )

  handle(IPC.duplicatesFind, (_event, distance?: number): DuplicateReport => ({
    exact: findExactDuplicates(),
    near: findNearDuplicates(distance ?? duplicateDistance()),
    pending: countPending('hash_state'),
  }))

  handle(IPC.duplicatesDistance, (): number => duplicateDistance())
  handle(IPC.duplicatesSetDistance, (_event, distance: number): number =>
    setDuplicateDistance(distance),
  )

  handle(
    IPC.mediaTrash,
    async (event, mediaIds: number[], options?: { confirm?: boolean }): Promise<number> => {
      if (mediaIds.length === 0) return 0

      const targets = await resolveExistingPaths(mediaIds)
      if (targets.length === 0) return 0

      // Callers opt out only where the gesture is already unambiguous. The
      // default stays on, so a new caller that says nothing gets the dialog.
      if (options?.confirm !== false) {
        const window = BrowserWindow.fromWebContents(event.sender)
        const question: Electron.MessageBoxOptions = {
          type: 'warning',
          buttons: ['Move to Trash', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
          title: 'Move files to Trash',
          message:
            targets.length === 1
              ? 'Move 1 file to the Trash?'
              : `Move ${targets.length} files to the Trash?`,
          detail:
            'They go to the system Trash, so you can still get them back. GoonLib will mark them as missing until the next scan.',
        }

        const answer = window
          ? await dialog.showMessageBox(window, question)
          : await dialog.showMessageBox(question)

        // Anything other than an explicit "Move to Trash" leaves the files alone.
        if (answer.response !== 0) return 0
      }

      // One Delete is one step of undo, however many files it took.
      const batch = []
      for (const target of targets) {
        try {
          batch.push(await trashHistory.trash(target.id, target.path))
        } catch (err) {
          console.error(`[trash] failed for ${target.path}:`, err)
        }
      }
      trashHistory.record(batch)

      return batch.length
    },
  )

  handle(IPC.mediaUndoTrash, (): Promise<TrashUndoResult> => trashHistory.undo())
  handle(IPC.mediaRedoTrash, (): Promise<TrashUndoResult> => trashHistory.redo())

  handle(
    IPC.mediaFileAction,
    (event, action: MediaFileAction, mediaId: number): Promise<boolean> =>
      runFileAction(BrowserWindow.fromWebContents(event.sender), action, Number(mediaId)),
  )

  handle(IPC.mediaMove, async (event, mediaIds: number[]): Promise<MoveResult> => {
    const idle: MoveResult = {
      chosen: false,
      destination: null,
      rehomed: 0,
      dropped: 0,
      renamed: 0,
      skipped: 0,
      failed: 0,
    }
    if (mediaIds.length === 0) return idle

    const targets = await resolveExistingPaths(mediaIds)
    if (targets.length === 0) return idle

    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Move to',
      buttonLabel: 'Move here',
      properties: ['openDirectory', 'createDirectory'],
    }

    const picked = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)

    const destination = picked.canceled ? undefined : picked.filePaths[0]
    if (!destination) return idle

    const roots = listRoots()
    const landing = containingRoot(roots, destination)

    // Landing outside the library is not a mistake, but it does mean the items
    // stop existing as far as GoonLib is concerned — along with their tags and
    // collection membership. That is worth saying out loud before it happens.
    if (!landing) {
      const warning: Electron.MessageBoxOptions = {
        type: 'warning',
        buttons: ['Move anyway', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Move out of the library',
        message:
          targets.length === 1
            ? 'Move 1 file outside your library folders?'
            : `Move ${targets.length} files outside your library folders?`,
        detail:
          'The files are moved as asked, but they will no longer be in the library - their tags and collections go with them.',
      }

      const answer = window
        ? await dialog.showMessageBox(window, warning)
        : await dialog.showMessageBox(warning)
      if (answer.response !== 0) return idle
    }

    const result: MoveResult = { ...idle, chosen: true, destination }

    // Seeded from the destination as it stands, then kept up to date as the
    // batch lands, so two files moved together cannot be given the same name.
    let taken: Set<string>
    try {
      taken = new Set(await readdir(destination))
    } catch (err) {
      console.error(`[move] cannot read ${destination}:`, err)
      return { ...idle, chosen: true, destination, failed: targets.length }
    }

    for (const target of targets) {
      if (dirname(target.path) === destination) {
        result.skipped += 1
        continue
      }

      const original = basename(target.path)
      const name = uniqueName(taken, original)
      const to = join(destination, name)

      try {
        await moveFile(target.path, to)
      } catch (err) {
        console.error(`[move] ${target.path} -> ${to}:`, err)
        result.failed += 1
        continue
      }

      taken.add(name)
      if (name !== original) result.renamed += 1

      if (landing) {
        relocateMedia(target.id, landing.root.id, relPathFor(landing.relDir, name), name)
        result.rehomed += 1
      } else {
        forgetMedia(target.id)
        result.dropped += 1
      }
    }

    return result
  })

  handle(IPC.mediaFavorite, (_event, mediaIds: number[], favorite: boolean): number =>
    setFavorite(mediaIds, favorite === true),
  )

  handle(IPC.revealInFinder, async (_event, mediaId: number): Promise<void> => {
    const [target] = await resolveExistingPaths([mediaId])
    if (target) shell.showItemInFolder(target.path)
  })

  handle(IPC.mediaAnnotations, (_event, mediaId: number): MediaAnnotations =>
    listAnnotations(mediaId),
  )

  handle(IPC.mediaViews, (_event, mediaId: number): MediaViews => viewsOf(Number(mediaId)))

  // Both sides of a position are gated here, not in the window: with the
  // setting off nothing is written and nothing is offered, whatever asks.
  handle(IPC.mediaPosition, (_event, mediaId: number): number | null =>
    playbackPrefs().resumePosition ? positionOf(Number(mediaId)) : null,
  )
  ipcMain.on(IPC.mediaSetPosition, (_event, mediaId: number, positionMs: number, durationMs: number) => {
    if (!playbackPrefs().resumePosition) return
    try {
      recordPosition(
        Number(mediaId),
        Number(positionMs),
        Number(durationMs),
        playbackPrefs().resumeAfterPercent / 100,
      )
    } catch (err) {
      console.error('[views] could not note a position:', err)
    }
  })
  handle(IPC.mediaContinue, (_event, limit: number): MediaItem[] =>
    playbackPrefs().resumePosition ? continueWatching(Number(limit)) : [],
  )
  handle(IPC.mediaClearHistory, (): number => clearHistory())
  handle(IPC.mediaForgetPosition, (_event, mediaId: number): void => forgetPosition(Number(mediaId)))
  ipcMain.on(IPC.mediaRecordView, (_event, mediaId: number, watchedMs: number) => {
    if (!playbackPrefs().keepHistory) return
    try {
      recordView(Number(mediaId), Number(watchedMs))
    } catch (err) {
      console.error('[views] could not record a view:', err)
    }
  })
  // Location is dropped here, not just hidden in the page, while Settings say
  // not to show it.
  handle(IPC.mediaExif, async (_event, mediaId: number): Promise<MediaExif | null> => {
    const item = getMedia(Number(mediaId))
    const [target] = await resolveExistingPaths([Number(mediaId)])
    if (!item || !target) return null
    const exif = await readExif(target.path, item.ext)
    if (!exif) return null
    return playbackPrefs().showLocation ? exif : { ...exif, location: null }
  })

  handle(IPC.tagsList, (): Tag[] => listTags())
  handle(IPC.tagsCreate, (_event, name: string): Tag => createTag(name))
  handle(IPC.tagsRename, (_event, id: number, name: string): Tag => renameTag(id, name))
  handle(IPC.tagsDelete, (_event, id: number): void => deleteTag(id))
  handle(IPC.tagsAssign, (_event, tagId: number, mediaIds: number[]): number =>
    tagMedia(tagId, mediaIds),
  )
  handle(IPC.tagsUnassign, (_event, tagId: number, mediaIds: number[]): void =>
    untagMedia(tagId, mediaIds),
  )

  // --- AI categorisation ---------------------------------------------------
  //
  // Note what is missing: there is no channel that returns the API key. The
  // renderer can set it, clear it, and be told whether one exists, and that is
  // the whole surface.

  handle(IPC.aiSettings, (): AiSettingsView => aiSettingsView())

  handle(IPC.aiUpdate, (_event, patch: Partial<AiSettings>): AiSettingsView => {
    setAiSettings(patch)
    // Switching provider or endpoint has to invalidate anything memoised against
    // the old one.
    resetClient()
    return aiSettingsView()
  })

  handle(IPC.aiSetKey, (_event, key: string): AiSettingsView => {
    setApiKey(key)
    // The client memoises on the key it was built with; drop it so the next
    // request picks the new one up without a restart.
    resetClient()
    return aiSettingsView()
  })

  handle(IPC.aiClearKey, (): AiSettingsView => {
    clearApiKey()
    resetClient()
    return aiSettingsView()
  })

  handle(IPC.aiTest, async (): Promise<AiTestResult> => {
    const settings = aiSettings()
    if (!aiReady(settings)) {
      return {
        ok: false,
        message:
          settings.provider === 'anthropic' ? 'No API key is set' : 'No server address is set',
      }
    }

    try {
      return { ok: true, message: await testConnection(settings) }
    } catch (err) {
      // Returned rather than thrown: a bad key or an unreachable server is an
      // expected answer to "test this", not an exceptional condition.
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })

  handle(IPC.aiModels, (): Promise<string[]> => listModels(aiSettings()))

  handle(IPC.aiReset, async (event): Promise<{ tags: number; collections: number; items: number } | null> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const question: Electron.MessageBoxOptions = {
      type: 'warning',
      buttons: ['Reset', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'Undo everything the classifier filed?',
      detail:
        'Every tag it applied goes, along with the items it sorted into collections, and any tag or collection that leaves empty. Your own tags, collections and files are untouched. Classifying again re-creates them.',
    }
    const answer = window
      ? await dialog.showMessageBox(window, question)
      : await dialog.showMessageBox(question)
    if (answer.response !== 0) return null

    const gone = resetClassification()
    console.log('[ai] reset:', gone)
    return gone
  })

  handle(IPC.aiReclassify, (_event, all: boolean): number => {
    const queued = queueForClassification(all)
    if (queued > 0) indexer.start()
    return queued
  })

  handle(IPC.scrapeStart, async (_event, url: string): Promise<ScrapeProgress> => {
    const folder = await scraper.start(url)

    // Adding the folder is the point of the feature, so it happens here rather
    // than being left to the user. `addRoot` is idempotent on the path, so
    // re-scraping a thread doesn't accumulate duplicate sources.
    if (folder) {
      const root = addRoot(folder)
      indexer.start(root.id)
    }

    return scraper.status()
  })

  handle(IPC.scrapeCancel, (): void => scraper.cancel())
  handle(IPC.scrapeStatus, (): ScrapeProgress => scraper.status())

  handle(IPC.scanStart, (_event, rootId?: number): void => indexer.start(rootId))
  handle(IPC.scanCancel, (): void => indexer.cancel())
  handle(IPC.scanStatus, (): ScanProgress => indexer.status())

  handle(IPC.playbackPrepare, (_event, id: number): Promise<PreparedMedia> => preparer.prepare(id))
  handle(IPC.playbackCancel, (_event, id: number): void => preparer.cancel(id))

  handle(IPC.playbackPrefs, (): PlaybackPrefs => playbackPrefs())
  // Returns what was stored, so the switches reflect the truth rather than
  // whatever they optimistically assumed.
  handle(IPC.playbackSetPrefs, (_event, patch: Partial<PlaybackPrefs>): PlaybackPrefs =>
    setPlaybackPrefs(patch),
  )

  handle(IPC.cowatchStatus, (): CoWatchSession => cowatch.status())
  handle(IPC.cowatchTunnels, (): Promise<string[]> => cowatch.tunnels())
  handle(IPC.cowatchHostName, (): string => hostName())
  handle(IPC.cowatchSetHostName, (_event, name: string): string => {
    const stored = setHostName(name)
    // A session already running shows the new name at once.
    cowatch.refresh()
    return stored
  })
  handle(
    IPC.cowatchStart,
    (_event, reach: CoWatchReach, provider?: CoWatchTunnelProvider): Promise<CoWatchSession> =>
      cowatch.start(reach, provider),
  )
  handle(IPC.cowatchStop, (): Promise<CoWatchSession> => cowatch.stop())
  handle(IPC.cowatchApprove, (_event, knockId: string, allow: boolean): CoWatchSession =>
    cowatch.approve(knockId, allow),
  )
  handle(IPC.cowatchKick, (_event, guestId: string): CoWatchSession => cowatch.kick(guestId))
  handle(IPC.cowatchSay, (_event, text: string): void => cowatch.say(text))
  handle(IPC.cowatchReact, (_event, emoji: string): void => cowatch.react(emoji))
  handle(IPC.cowatchIntent, (_event, intent: CoWatchIntent): void => cowatch.intent(intent))
  handle(IPC.cowatchReady, (_event, mediaId: number, ready: boolean): void =>
    cowatch.ready(mediaId, ready),
  )
  handle(IPC.cowatchRequestControl, (): void => cowatch.requestControl())
  handle(IPC.cowatchCancelControl, (): void => cowatch.cancelControlRequest())
  handle(IPC.cowatchAnswerControl, (_event, peerId: string, allow: boolean): void =>
    cowatch.answerControl(String(peerId), allow === true),
  )
  handle(IPC.cowatchQueue, (_event, mediaIds: number[]): void => cowatch.setQueue(mediaIds))
  handle(IPC.cowatchCopy, (): boolean => {
    // The renderer cannot reach the Clipboard API — this app denies every
    // permission request — and it passes no text either, so the only thing this
    // can ever put on the clipboard is the session's own link.
    const url = cowatch.status().url
    if (!url) return false
    clipboard.writeText(url)
    return true
  })

  // --- themes ----------------------------------------------------------------

  handle(IPC.themeState, (): ThemeState => themes.state())
  // Synchronous, for the preload: the page is coloured before its first paint.
  ipcMain.on(IPC.themeState, (event) => {
    event.returnValue = themes.state()
  })
  handle(IPC.themeSetMode, (_event, mode: ThemeMode) => themes.setMode(mode))
  handle(IPC.themeUse, (_event, side: ThemeType, theme: Theme) =>
    themes.use(side === 'light' ? 'light' : 'dark', theme),
  )
  handle(IPC.themeSave, (_event, side: ThemeType, theme: Theme) =>
    themes.save(side === 'light' ? 'light' : 'dark', theme),
  )
  handle(IPC.themeRemove, (_event, id: string) => themes.remove(String(id)))
  handle(IPC.themeImport, (event) => themes.import(BrowserWindow.fromWebContents(event.sender)))
  handle(IPC.themeExport, (event, theme: Theme) =>
    themes.export(BrowserWindow.fromWebContents(event.sender), theme),
  )
  handle(IPC.themeReveal, (): void => themes.revealFolder())

  handle(IPC.settingsExport, (event): Promise<boolean> =>
    exportSettings(BrowserWindow.fromWebContents(event.sender)),
  )
  handle(IPC.settingsImport, (event): Promise<boolean> =>
    importSettings(BrowserWindow.fromWebContents(event.sender)),
  )
  themes.on('change', (state: ThemeState) => broadcast(IPC.themeUpdate, state))

  // --- toys ------------------------------------------------------------------

  handle(IPC.toyStatus, (): ToyStatus => toys.status())
  handle(IPC.toyConnect, (): Promise<ToyStatus> => toys.connect())
  handle(IPC.toyDisconnect, (): Promise<ToyStatus> => toys.disconnect())
  handle(IPC.toyScan, (): Promise<ToyStatus> => toys.scan())
  handle(IPC.toyStop, (): Promise<ToyStatus> => toys.stop())
  handle(IPC.toyResume, (): ToyStatus => toys.resume())
  handle(IPC.toyManual, (_event, manual: ToyManual | null): ToyStatus => toys.manual(manual))
  handle(IPC.toyPrefs, (): ToyPrefs => toys.prefs)
  handle(IPC.toySetPrefs, (_event, patch: Partial<ToyPrefs>): ToyPrefs => toys.setPrefs(patch))
  handle(IPC.toyPatternSave, (_event, draft: CustomPatternDraft) => toys.savePattern(draft))
  handle(IPC.toyPatternDelete, (_event, id: number): ToyStatus => toys.removePattern(Number(id)))
  handle(
    IPC.toyCurve,
    (_event, mediaId: number, durationMs: number, points: number): number[] | null =>
      toys.curve(Number(mediaId), Number(durationMs), Number(points)),
  )
  ipcMain.on(IPC.toyPlayback, (_event, state: ToyPlayback) => toys.playback(state))
  ipcMain.on(IPC.toyPreview, (_event, level: number | null) => toys.preview(level))

  toys.on('change', () => broadcast(IPC.toyUpdate, toys.status()))

  // Guests reach the toy only through the session, and only while the host
  // has offered it. The session asks here for every buzz rather than keeping
  // its own idea of whether the toy is open.
  cowatch.setBuzzHandler((guestId, name, body) => toys.buzz(guestId, name, body))
  toys.on('change', () => cowatch.setToyOffer(toys.guestOffer()))

  // Progress is pushed rather than polled so the UI stays current without a timer.
  indexer.on('progress', (progress: ScanProgress) => broadcast(IPC.scanProgress, progress))
  preparer.on('progress', (progress: PrepareProgress) => broadcast(IPC.playbackProgress, progress))
  scraper.on('progress', (progress: ScrapeProgress) => broadcast(IPC.scrapeProgress, progress))

  // The session moves for reasons the host never touched — someone knocking,
  // a guest finishing a transcode — so the panel is pushed, never polled.
  cowatch.on('change', () => broadcast(IPC.cowatchUpdate, cowatch.status()))
  cowatch.on('reaction', (reaction: unknown) => broadcast(IPC.cowatchReaction, reaction))
}

function broadcast(channel: string, payload: unknown): void {
  for (const contents of webContents.getAllWebContents()) {
    if (!contents.isDestroyed()) contents.send(channel, payload)
  }
}

/**
 * Wraps ipcMain.handle so a thrown error reaches the renderer as a readable
 * message instead of Electron's default "Error invoking remote method" wrapper.
 */
function handle<Args extends unknown[], Result>(
  channel: string,
  listener: (event: Electron.IpcMainInvokeEvent, ...args: Args) => Result | Promise<Result>,
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await listener(event, ...(args as Args))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[ipc] ${channel} failed:`, err)
      throw new Error(message)
    }
  })
}

/**
 * Turns media ids into real on-disk paths, dropping anything that has moved or
 * escaped its root. Everything destructive goes through here so no code path can
 * act on a path the renderer supplied.
 */
async function resolveExistingPaths(
  mediaIds: number[],
): Promise<Array<{ id: number; path: string }>> {
  const resolved: Array<{ id: number; path: string }> = []

  for (const id of mediaIds) {
    const location = getMediaLocation(id)
    if (!location) continue

    const path = await resolveWithinRoot(location.rootPath, location.relPath)
    if (path) resolved.push({ id, path })
  }

  return resolved
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function appInfo(): AppInfo {
  return {
    version: app.getVersion(),
    electron: process.versions.electron ?? 'unknown',
    chrome: process.versions.chrome ?? 'unknown',
    node: process.versions.node ?? 'unknown',
    userData: app.getPath('userData'),
    dbPath: dbPath(),
    ffmpeg: ffmpegPath(),
    ffprobe: ffprobePath(),
  }
}
