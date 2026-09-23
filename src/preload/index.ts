/**
 * The only bridge between the renderer and the main process.
 *
 * This file runs in a sandboxed context, so it must stay a single self-contained
 * CommonJS bundle whose only import is `electron`. It deliberately exposes a fixed
 * set of named calls rather than a generic `invoke(channel, ...)` — a generic
 * passthrough would hand the renderer the entire IPC surface.
 */

import { contextBridge, ipcRenderer } from 'electron'
import type { Theme, ThemeMode, ThemeType } from '@shared/theme'
import type { CustomPattern } from '@shared/toy'
import { IPC } from '@shared/types'
import type {
  AiSettings,
  CoWatchIntent,
  CoWatchReach,
  CoWatchReaction,
  CoWatchTunnelProvider,
  CoWatchSession,
  AiSettingsView,
  AiTestResult,
  AppInfo,
  Collection,
  DuplicateReport,
  FolderNode,
  GoonLibApi,
  ThemeImport,
  ThemeState,
  LibraryStats,
  MediaAnnotations,
  MediaExif,
  MediaFileAction,
  MediaItem,
  MediaViews,
  MediaPage,
  MoveResult,
  MediaQuery,
  PlaybackPrefs,
  PrepareProgress,
  PreparedMedia,
  Root,
  ScanProgress,
  ScrapeProgress,
  Tag,
  CustomPatternDraft,
  ToyManual,
  TrashUndoResult,
  ToyPlayback,
  ToyPrefs,
  ToyStatus,
} from '@shared/types'

const api: GoonLibApi = {
  app: {
    info: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.appInfo),
  },
  roots: {
    list: (): Promise<Root[]> => ipcRenderer.invoke(IPC.rootsList),
    add: (): Promise<Root | null> => ipcRenderer.invoke(IPC.rootsAdd),
    remove: (id: number): Promise<void> => ipcRenderer.invoke(IPC.rootsRemove, id),
    setEnabled: (id: number, enabled: boolean): Promise<void> =>
      ipcRenderer.invoke(IPC.rootsSetEnabled, id, enabled),
  },
  library: {
    stats: (): Promise<LibraryStats> => ipcRenderer.invoke(IPC.libraryStats),
    list: (query: MediaQuery): Promise<MediaPage> => ipcRenderer.invoke(IPC.mediaList, query),
    get: (id: number): Promise<MediaItem | null> => ipcRenderer.invoke(IPC.mediaGet, id),
    ids: (query: Omit<MediaQuery, 'limit' | 'offset'>): Promise<number[]> =>
      ipcRenderer.invoke(IPC.mediaIds, query),
  },
  folders: {
    children: (rootId: number, path: string): Promise<FolderNode[]> =>
      ipcRenderer.invoke(IPC.foldersChildren, rootId, path),
  },
  collections: {
    list: (): Promise<Collection[]> => ipcRenderer.invoke(IPC.collectionsList),
    create: (name: string): Promise<Collection> => ipcRenderer.invoke(IPC.collectionsCreate, name),
    rename: (id: number, name: string): Promise<void> =>
      ipcRenderer.invoke(IPC.collectionsRename, id, name),
    remove: (id: number): Promise<void> => ipcRenderer.invoke(IPC.collectionsDelete, id),
    add: (collectionId: number, mediaIds: number[]): Promise<number> =>
      ipcRenderer.invoke(IPC.collectionsAdd, collectionId, mediaIds),
    removeItems: (collectionId: number, mediaIds: number[]): Promise<void> =>
      ipcRenderer.invoke(IPC.collectionsRemove, collectionId, mediaIds),
    of: (mediaId: number): Promise<number[]> => ipcRenderer.invoke(IPC.collectionsOf, mediaId),
    move: (collectionId: number, mediaId: number, toIndex: number): Promise<void> =>
      ipcRenderer.invoke(IPC.collectionsMove, collectionId, mediaId, toIndex),
    setCover: (collectionId: number, mediaId: number | null): Promise<void> =>
      ipcRenderer.invoke(IPC.collectionsSetCover, collectionId, mediaId),
  },
  duplicates: {
    find: (distance?: number): Promise<DuplicateReport> =>
      ipcRenderer.invoke(IPC.duplicatesFind, distance),
    distance: (): Promise<number> => ipcRenderer.invoke(IPC.duplicatesDistance),
    setDistance: (distance: number): Promise<number> =>
      ipcRenderer.invoke(IPC.duplicatesSetDistance, distance),
  },
  media: {
    trash: (mediaIds: number[], options?: { confirm?: boolean }): Promise<number> =>
      ipcRenderer.invoke(IPC.mediaTrash, mediaIds, options),
    undoTrash: (): Promise<TrashUndoResult> => ipcRenderer.invoke(IPC.mediaUndoTrash),
    redoTrash: (): Promise<TrashUndoResult> => ipcRenderer.invoke(IPC.mediaRedoTrash),
    move: (mediaIds: number[]): Promise<MoveResult> =>
      ipcRenderer.invoke(IPC.mediaMove, mediaIds),
    favorite: (mediaIds: number[], favorite: boolean): Promise<number> =>
      ipcRenderer.invoke(IPC.mediaFavorite, mediaIds, favorite),
    reveal: (mediaId: number): Promise<void> => ipcRenderer.invoke(IPC.revealInFinder, mediaId),
    fileAction: (action: MediaFileAction, mediaId: number): Promise<boolean> =>
      ipcRenderer.invoke(IPC.mediaFileAction, action, mediaId),
    annotations: (mediaId: number): Promise<MediaAnnotations> =>
      ipcRenderer.invoke(IPC.mediaAnnotations, mediaId),
    views: (mediaId: number): Promise<MediaViews> => ipcRenderer.invoke(IPC.mediaViews, mediaId),
    recordView: (mediaId: number, watchedMs: number): void =>
      ipcRenderer.send(IPC.mediaRecordView, mediaId, watchedMs),
    exif: (mediaId: number): Promise<MediaExif | null> => ipcRenderer.invoke(IPC.mediaExif, mediaId),
  },
  tags: {
    list: (): Promise<Tag[]> => ipcRenderer.invoke(IPC.tagsList),
    create: (name: string): Promise<Tag> => ipcRenderer.invoke(IPC.tagsCreate, name),
    rename: (id: number, name: string): Promise<Tag> =>
      ipcRenderer.invoke(IPC.tagsRename, id, name),
    remove: (id: number): Promise<void> => ipcRenderer.invoke(IPC.tagsDelete, id),
    assign: (tagId: number, mediaIds: number[]): Promise<number> =>
      ipcRenderer.invoke(IPC.tagsAssign, tagId, mediaIds),
    unassign: (tagId: number, mediaIds: number[]): Promise<void> =>
      ipcRenderer.invoke(IPC.tagsUnassign, tagId, mediaIds),
  },
  ai: {
    settings: (): Promise<AiSettingsView> => ipcRenderer.invoke(IPC.aiSettings),
    update: (patch: Partial<AiSettings>): Promise<AiSettingsView> =>
      ipcRenderer.invoke(IPC.aiUpdate, patch),
    // One-way by design: there is no matching getter, so a compromised page has
    // no channel to read the key back out of.
    setKey: (key: string): Promise<AiSettingsView> => ipcRenderer.invoke(IPC.aiSetKey, key),
    clearKey: (): Promise<AiSettingsView> => ipcRenderer.invoke(IPC.aiClearKey),
    test: (): Promise<AiTestResult> => ipcRenderer.invoke(IPC.aiTest),
    models: (): Promise<string[]> => ipcRenderer.invoke(IPC.aiModels),
    reclassify: (all: boolean): Promise<number> => ipcRenderer.invoke(IPC.aiReclassify, all),
    reset: (): Promise<{ tags: number; collections: number; items: number } | null> =>
      ipcRenderer.invoke(IPC.aiReset),
  },
  scrape: {
    start: (url: string): Promise<ScrapeProgress> => ipcRenderer.invoke(IPC.scrapeStart, url),
    cancel: (): Promise<void> => ipcRenderer.invoke(IPC.scrapeCancel),
    status: (): Promise<ScrapeProgress> => ipcRenderer.invoke(IPC.scrapeStatus),
    onProgress: (listener: (progress: ScrapeProgress) => void): (() => void) => {
      const wrapped = (_event: unknown, progress: ScrapeProgress): void => listener(progress)
      ipcRenderer.on(IPC.scrapeProgress, wrapped)
      return () => ipcRenderer.removeListener(IPC.scrapeProgress, wrapped)
    },
  },
  scan: {
    start: (rootId?: number): Promise<void> => ipcRenderer.invoke(IPC.scanStart, rootId),
    cancel: (): Promise<void> => ipcRenderer.invoke(IPC.scanCancel),
    status: (): Promise<ScanProgress> => ipcRenderer.invoke(IPC.scanStatus),
    onProgress: (listener: (progress: ScanProgress) => void): (() => void) => {
      // The IpcRendererEvent is deliberately not forwarded — it carries `sender`,
      // which would hand the renderer a way back into the IPC layer.
      const wrapped = (_event: unknown, progress: ScanProgress): void => listener(progress)
      ipcRenderer.on(IPC.scanProgress, wrapped)
      return () => ipcRenderer.removeListener(IPC.scanProgress, wrapped)
    },
  },
  playback: {
    prepare: (id: number): Promise<PreparedMedia> => ipcRenderer.invoke(IPC.playbackPrepare, id),
    cancel: (id: number): Promise<void> => ipcRenderer.invoke(IPC.playbackCancel, id),
    onProgress: (listener: (progress: PrepareProgress) => void): (() => void) => {
      const wrapped = (_event: unknown, progress: PrepareProgress): void => listener(progress)
      ipcRenderer.on(IPC.playbackProgress, wrapped)
      return () => ipcRenderer.removeListener(IPC.playbackProgress, wrapped)
    },
    prefs: (): Promise<PlaybackPrefs> => ipcRenderer.invoke(IPC.playbackPrefs),
    setPrefs: (patch: Partial<PlaybackPrefs>): Promise<PlaybackPrefs> =>
      ipcRenderer.invoke(IPC.playbackSetPrefs, patch),
  },
  cowatch: {
    status: (): Promise<CoWatchSession> => ipcRenderer.invoke(IPC.cowatchStatus),
    tunnels: (): Promise<string[]> => ipcRenderer.invoke(IPC.cowatchTunnels),
    hostName: (): Promise<string> => ipcRenderer.invoke(IPC.cowatchHostName),
    setHostName: (name: string): Promise<string> => ipcRenderer.invoke(IPC.cowatchSetHostName, name),
    start: (reach: CoWatchReach, provider?: CoWatchTunnelProvider): Promise<CoWatchSession> =>
      ipcRenderer.invoke(IPC.cowatchStart, reach, provider),
    stop: (): Promise<CoWatchSession> => ipcRenderer.invoke(IPC.cowatchStop),
    approve: (knockId: string, allow: boolean): Promise<CoWatchSession> =>
      ipcRenderer.invoke(IPC.cowatchApprove, knockId, allow),
    kick: (guestId: string): Promise<CoWatchSession> =>
      ipcRenderer.invoke(IPC.cowatchKick, guestId),
    say: (text: string): Promise<void> => ipcRenderer.invoke(IPC.cowatchSay, text),
    react: (emoji: string): Promise<void> => ipcRenderer.invoke(IPC.cowatchReact, emoji),
    intent: (intent: CoWatchIntent): Promise<void> =>
      ipcRenderer.invoke(IPC.cowatchIntent, intent),
    requestControl: (): Promise<void> => ipcRenderer.invoke(IPC.cowatchRequestControl),
    cancelControlRequest: (): Promise<void> => ipcRenderer.invoke(IPC.cowatchCancelControl),
    answerControl: (peerId: string, allow: boolean): Promise<void> =>
      ipcRenderer.invoke(IPC.cowatchAnswerControl, peerId, allow),
    ready: (mediaId: number, ready: boolean): Promise<void> =>
      ipcRenderer.invoke(IPC.cowatchReady, mediaId, ready),
    setQueue: (mediaIds: number[]): Promise<void> =>
      ipcRenderer.invoke(IPC.cowatchQueue, mediaIds),
    copyInvite: (): Promise<boolean> => ipcRenderer.invoke(IPC.cowatchCopy),
    onUpdate: (listener: (session: CoWatchSession) => void): (() => void) => {
      const wrapped = (_event: unknown, session: CoWatchSession): void => listener(session)
      ipcRenderer.on(IPC.cowatchUpdate, wrapped)
      return () => ipcRenderer.removeListener(IPC.cowatchUpdate, wrapped)
    },
    onReaction: (listener: (reaction: CoWatchReaction) => void): (() => void) => {
      const wrapped = (_event: unknown, reaction: CoWatchReaction): void => listener(reaction)
      ipcRenderer.on(IPC.cowatchReaction, wrapped)
      return () => ipcRenderer.removeListener(IPC.cowatchReaction, wrapped)
    },
  },
  theme: {
    // Asked for synchronously, once, so the first paint is already in the
    // right colours. Everything after that arrives through onUpdate.
    initial: ipcRenderer.sendSync(IPC.themeState) as ThemeState,
    state: (): Promise<ThemeState> => ipcRenderer.invoke(IPC.themeState),
    setMode: (mode: ThemeMode): Promise<ThemeState> => ipcRenderer.invoke(IPC.themeSetMode, mode),
    use: (side: ThemeType, theme: Theme): Promise<ThemeState> =>
      ipcRenderer.invoke(IPC.themeUse, side, theme),
    save: (side: ThemeType, theme: Theme): Promise<ThemeState> =>
      ipcRenderer.invoke(IPC.themeSave, side, theme),
    remove: (id: string): Promise<ThemeState> => ipcRenderer.invoke(IPC.themeRemove, id),
    import: (): Promise<ThemeImport> => ipcRenderer.invoke(IPC.themeImport),
    export: (theme: Theme): Promise<boolean> => ipcRenderer.invoke(IPC.themeExport, theme),
    revealFolder: (): Promise<void> => ipcRenderer.invoke(IPC.themeReveal),
    onUpdate: (listener: (state: ThemeState) => void): (() => void) => {
      const wrapped = (_event: unknown, state: ThemeState): void => listener(state)
      ipcRenderer.on(IPC.themeUpdate, wrapped)
      return () => ipcRenderer.removeListener(IPC.themeUpdate, wrapped)
    },
  },
  toy: {
    status: (): Promise<ToyStatus> => ipcRenderer.invoke(IPC.toyStatus),
    connect: (): Promise<ToyStatus> => ipcRenderer.invoke(IPC.toyConnect),
    disconnect: (): Promise<ToyStatus> => ipcRenderer.invoke(IPC.toyDisconnect),
    scan: (): Promise<ToyStatus> => ipcRenderer.invoke(IPC.toyScan),
    stop: (): Promise<ToyStatus> => ipcRenderer.invoke(IPC.toyStop),
    resume: (): Promise<ToyStatus> => ipcRenderer.invoke(IPC.toyResume),
    manual: (manual: ToyManual | null): Promise<ToyStatus> =>
      ipcRenderer.invoke(IPC.toyManual, manual),
    // A send rather than an invoke: the player reports several times a second
    // and has no use for an answer.
    playback: (state: ToyPlayback): void => ipcRenderer.send(IPC.toyPlayback, state),
    preview: (level: number | null): void => ipcRenderer.send(IPC.toyPreview, level),
    prefs: (): Promise<ToyPrefs> => ipcRenderer.invoke(IPC.toyPrefs),
    setPrefs: (patch: Partial<ToyPrefs>): Promise<ToyPrefs> =>
      ipcRenderer.invoke(IPC.toySetPrefs, patch),
    curve: (mediaId: number, durationMs: number, points: number): Promise<number[] | null> =>
      ipcRenderer.invoke(IPC.toyCurve, mediaId, durationMs, points),
    savePattern: (draft: CustomPatternDraft): Promise<CustomPattern> =>
      ipcRenderer.invoke(IPC.toyPatternSave, draft),
    deletePattern: (id: number): Promise<ToyStatus> => ipcRenderer.invoke(IPC.toyPatternDelete, id),
    onUpdate: (listener: (status: ToyStatus) => void): (() => void) => {
      const wrapped = (_event: unknown, status: ToyStatus): void => listener(status)
      ipcRenderer.on(IPC.toyUpdate, wrapped)
      return () => ipcRenderer.removeListener(IPC.toyUpdate, wrapped)
    },
  },
}

contextBridge.exposeInMainWorld('goonlib', api)
