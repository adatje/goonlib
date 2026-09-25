import type { KeyBindings } from './keys'
import type { Theme, ThemeConfig, ThemeMode, ThemeType } from './theme'
import type { CustomPattern, PatternId, PatternShape, VibrateFrom } from './toy'

/**
 * The IPC contract. This is the single source of truth shared by the main process,
 * the preload bridge, and the renderer — if a channel isn't described here, it
 * doesn't exist.
 */

export type MediaKind = 'image' | 'video'

/**
 * How a video can be delivered to a <video> element.
 *  - native:    Chromium plays the file as-is, stream it straight through.
 *  - remux:     codecs are fine but the container isn't (MKV, some MOV) — repackage
 *               to fragmented MP4 with `-c copy`. Effectively free.
 *  - transcode: codecs Chromium can't decode (HEVC, VC-1, WMV3, MPEG-4 part 2,
 *               ProRes) — re-encode to H.264. Expensive, cached, done lazily.
 */
export type PlaybackTier = 'native' | 'remux' | 'transcode'

/** Per-stage progress marker, so an interrupted scan resumes instead of restarting. */
export type StageState = 'pending' | 'running' | 'done' | 'error' | 'skipped'

export interface Root {
  id: number
  path: string
  enabled: boolean
  addedAt: number
}

export interface MediaItem {
  id: number
  rootId: number
  relPath: string
  name: string
  ext: string
  kind: MediaKind
  size: number
  mtime: number
  width: number | null
  height: number | null
  durationMs: number | null
  vcodec: string | null
  acodec: string | null
  fps: number | null
  playbackTier: PlaybackTier | null
  contentHash: string | null
  phash: string | null
  probeState: StageState
  thumbState: StageState
  spriteState: StageState
  hashState: StageState
  classifyState: StageState
  addedAt: number
  missing: boolean
  /** When the user favorited this, or null if they haven't. */
  favoritedAt: number | null
  /** Hover-scrub sheet geometry. Null until the sprite stage has run. */
  sprite: SpriteLayout | null
}

export interface SpriteLayout {
  frames: number
  columns: number
  cellWidth: number
  cellHeight: number
}

export interface LibraryStats {
  total: number
  images: number
  videos: number
  missing: number
  favorites: number
}

/**
 * The three platforms the app is built for. Anything else Node might report is
 * folded into 'linux' by the bridge: the differences that matter here are the
 * window chrome, the name of the file manager and the Recycle Bin, and on that
 * score every other Unix behaves like Linux.
 */
export type Platform = 'darwin' | 'win32' | 'linux'

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  userData: string
  dbPath: string
  /** Resolved ffmpeg/ffprobe binaries, or null if neither bundled nor on PATH. */
  ffmpeg: string | null
  ffprobe: string | null
}

export interface Collection {
  id: number
  name: string
  coverMediaId: number | null
  createdAt: number
  count: number
  /**
   * How many of those the classifier filed rather than you. Equal to `count`
   * means nothing here was filed by hand — the same mark tags carry.
   */
  aiCount: number
}

export interface Tag {
  id: number
  name: string
  /** Items carrying this tag, however it got there. */
  count: number
  /**
   * How many of those came from the classifier rather than the user. Equal to
   * `count` means nothing here was filed by hand — worth showing, because those
   * are the tags a re-classification can recreate after you delete them.
   */
  aiCount: number
}

/** 'manual' is only meaningful inside a collection, where the user sets the order. */
export type MediaSort = 'added' | 'name' | 'size' | 'duration' | 'manual' | 'shuffle'

export interface FolderNode {
  name: string
  /** Path relative to the root, always ending in '/'. */
  path: string
  /** Items anywhere beneath this folder, matching what selecting it will show. */
  count: number
  hasChildren: boolean
}

/** Where the user currently is in the folder hierarchy. */
export interface FolderLocation {
  rootId: number
  /** '' for the root itself, otherwise a path ending in '/'. */
  path: string
}

/**
 * The bands the Filters panel offers, rather than numbers to type. The edges
 * are here so the window and the database agree on what "medium" means.
 */
export type DurationBand = 'short' | 'medium' | 'long'
export type SizeBand = 'small' | 'medium' | 'large'

/** Short is under five minutes, long is over twenty. */
export const DURATION_BANDS: Record<DurationBand, { from: number; to: number | null; label: string }> = {
  short: { from: 0, to: 5 * 60_000, label: 'Short' },
  medium: { from: 5 * 60_000, to: 20 * 60_000, label: 'Medium' },
  long: { from: 20 * 60_000, to: null, label: 'Long' },
}

/** Small is under 100 MB, large is over a gigabyte. */
export const SIZE_BANDS: Record<SizeBand, { from: number; to: number | null; label: string }> = {
  small: { from: 0, to: 100 * 1024 * 1024, label: 'Small' },
  medium: { from: 100 * 1024 * 1024, to: 1024 * 1024 * 1024, label: 'Medium' },
  large: { from: 1024 * 1024 * 1024, to: null, label: 'Large' },
}

export interface MediaQuery {
  kind?: MediaKind | 'all'
  /** Free text matched against filename and path via FTS5. */
  search?: string
  /** Restrict to one library folder. */
  rootId?: number
  /** Restrict to everything beneath this path, relative to the root. */
  pathPrefix?: string
  /**
   * Only items sitting directly in `pathPrefix`, rather than everywhere beneath
   * it. What a file browser shows: subfolders are listed as folders, not
   * flattened into the same grid as their parent's own files.
   */
  directOnly?: boolean
  /** Restrict to the members of one collection. */
  collectionId?: number
  /** Restrict to items carrying one tag, whoever applied it. */
  tagId?: number
  /** Restrict to items carrying every one of these tags. */
  tagIds?: number[]
  /** Restrict to these file types, as extensions with the dot. */
  exts?: string[]
  /** Restrict to videos of these lengths. Any band set leaves images out. */
  durations?: DurationBand[]
  /** Restrict to files of these sizes. */
  sizes?: SizeBand[]
  /** Restrict to favorited items. */
  favorite?: boolean
  sort?: MediaSort
  order?: 'asc' | 'desc'
  /**
   * For the shuffle sort: which shuffle. The same seed gives the same order,
   * so paging through a shuffled grid stays put; a new one reshuffles.
   */
  seed?: number
  limit: number
  offset: number
  includeMissing?: boolean
}

export interface MediaPage {
  items: MediaItem[]
  /** Total matching the query, ignoring limit/offset — the grid needs it to size itself. */
  total: number
  /** Their combined size on disk, in bytes. */
  totalBytes: number
}

export type ScanPhase =
  | 'idle'
  | 'walking'
  | 'probing'
  | 'thumbnailing'
  | 'previewing'
  | 'hashing'
  | 'classifying'
  | 'done'
  | 'cancelled'
  | 'error'

export interface ScanProgress {
  phase: ScanPhase
  /** The folder currently being walked, if any. */
  currentRoot: string | null
  discovered: number
  probed: number
  thumbed: number
  previewed: number
  hashed: number
  classified: number
  pendingProbe: number
  pendingThumb: number
  pendingSprite: number
  pendingHash: number
  pendingClassify: number
  errors: number
  message: string | null
}

export interface DuplicateGroup {
  /** Stable identity for the group, for React keys and selection. */
  key: string
  kind: 'exact' | 'near'
  /** Hamming distance threshold that produced a near group; 0 for exact. */
  distance: number
  /** Members, largest file first. */
  items: MediaItem[]
  /** Bytes freed by keeping exactly one member. */
  reclaimable: number
}

export interface DuplicateReport {
  exact: DuplicateGroup[]
  near: DuplicateGroup[]
  /** Items still awaiting a hash, so the UI can say the picture is incomplete. */
  pending: number
}

/** What the right-click menu asks the main process to do with a file. */
export type MediaFileAction =
  | 'copy'
  | 'copy-image'
  | 'copy-path'
  | 'copy-name'
  | 'reveal'
  | 'trash'

/**
 * How the viewer behaves around starting and finishing a video.
 *
 * One switch rather than two. "Play what I open, and keep going" is a single
 * intent, and splitting it made two adjacent toggles that were easy to mistake
 * for one another — and half of it on was a state nobody asked for.
 */
export interface PlaybackPrefs {
  /** Move on by itself: to the next item when a video ends, or after the timer on an image. */
  autoplay: boolean
  /** Start a video playing as soon as it is opened. */
  playOnOpen: boolean
  /** Where the volume slider was last left, from 0 to 1. Every video opens at it. */
  volume: number
  muted: boolean
  /** What shuffle picks from: videos, images, or both. Chosen by right-clicking it. */
  randomKind: MediaKind | 'all'
  /** How long autoplay shows an image before moving on, in whole seconds. */
  imageSeconds: number
  /** Shuffle starts switched on. */
  shuffleDefault: boolean
  /** The viewer's details panel shows the item's file details and viewing history. */
  showMetadata: boolean
  /** The details panel shows a photo's EXIF: camera, settings, date taken. */
  showExif: boolean
  /** EXIF includes where the photo was taken, when it says. */
  showLocation: boolean
  /** The viewer shows the item's description and tags over the media. */
  showDescription: boolean
  /** Of those, the description itself. */
  showCaption: boolean
  /** Of those, the tag chips. */
  showTags: boolean
  /** The open item repeats instead of the viewer moving on. */
  loop: boolean
  /** Count views and time watched. Off, nothing new is recorded. */
  keepHistory: boolean
  /** Note where a video was left, and carry on from there next time. */
  resumePosition: boolean
  /**
   * How far into a video you must be before the place is kept, as a percentage
   * of its length. 0 keeps any position; the top of the range is half way.
   */
  resumeAfterPercent: number
  /** Show the Continue watching row above the library. */
  showContinue: boolean
  /** The most part-watched videos Continue watching will hold. */
  continueCount: number
  /** Opening something in a Watch Together session starts at the host's position. */
  resumeInSessions: boolean
}

/** The range Image autoplay timer is held to, in seconds. */
export const IMAGE_SECONDS = { min: 1, max: 500, default: 8 } as const

/** The range "remember after" is held to, as a percentage of a video's length. */
export const RESUME_AFTER = { min: 0, max: 50, default: 30 } as const

/** How many items Continue watching may hold. */
export const CONTINUE_COUNT = { min: 3, max: 50, default: 20 } as const

// ---------------------------------------------------------------------------
// Toys
// ---------------------------------------------------------------------------

/**
 * Where the connection to the toy stands.
 *
 * `installing` only ever happens once, the first time: the engine that speaks
 * Bluetooth is downloaded on demand rather than shipped with every copy.
 */
export type ToyEngineState = 'off' | 'installing' | 'starting' | 'ready' | 'error'

export interface ToyDevice {
  index: number
  name: string
  /** Has at least one motor that takes a strength. */
  vibrate: boolean
  /** Moves to a position over a time, like a stroker. Follows a funscript directly. */
  stroke: boolean
  /** Battery from 0 to 1, or null if the device does not say. */
  battery: number | null
}

/** What the toy is following in the video on screen. */
export type ToyScriptState =
  | { kind: 'none'; mediaId: number | null }
  | { kind: 'loading'; mediaId: number }
  | { kind: 'funscript'; mediaId: number; name: string }
  | { kind: 'audio'; mediaId: number }
  | { kind: 'error'; mediaId: number; message: string }

export interface ToyManual {
  /**
   * A built-in or saved pattern — or `preview`, for a shape still being drawn,
   * which then travels with it in `shape`.
   */
  pattern: PatternId | 'preview'
  intensity: number
  shape?: PatternShape
}

/** A drawn pattern on its way to being saved. No id means a new one. */
export interface CustomPatternDraft extends PatternShape {
  id?: number
  name: string
}

export interface ToyStatus {
  engine: ToyEngineState
  /**
   * `bundled` when GoonLib runs its own engine; `external` when it found an
   * Intiface Central already running and connected to that instead.
   */
  server: 'bundled' | 'external' | null
  /** Whether the engine has been downloaded yet. */
  installed: boolean
  /** Whether there is an engine download for this machine at all. */
  supported: boolean
  /** Download progress from 0 to 100 while installing. */
  progress: number | null
  /** Why the engine is not up, or what to do about it. */
  message: string | null
  scanning: boolean
  devices: ToyDevice[]
  /**
   * Nothing moves the toy unless this is true. Stop clears it; only an explicit
   * resume sets it again, so a stop can never be undone by the next frame of a
   * script or the next guest's buzz.
   */
  armed: boolean
  /** Strength being sent right now, after every limit, from 0 to 1. */
  level: number
  script: ToyScriptState
  /** A pattern left running from the panel, or null. Never carries the shape. */
  manual: { pattern: PatternId | 'preview'; intensity: number } | null
  /** Patterns the user has drawn and saved, offered beside the built-in ones. */
  patterns: CustomPattern[]
  guests: {
    /** Whether guests are being offered the toy right now. */
    open: boolean
    playing: { name: string; pattern: PatternId; remainingMs: number } | null
    waiting: number
  }
}

export interface ToyPrefs {
  /** Ceiling on everything, from every source, from 0.05 to 1. */
  maxIntensity: number
  /**
   * How far ahead of the picture commands are sent, to make up for Bluetooth
   * lag. Negative if the toy somehow runs early.
   */
  leadMs: number
  /** How a stroke script is felt on something that can only vibrate. */
  vibrateFrom: VibrateFrom
  /** Play the video's funscript, or its audio, while it plays. */
  followVideo: boolean
  /** With no funscript, follow the loudness of the soundtrack instead. */
  audio: boolean
  /** Moving an intensity slider in Settings plays it on the toy as it moves. */
  preview: boolean
  /** Offer the toy to co-watching guests. Off until the host turns it on. */
  guests: boolean
  guestMaxIntensity: number
  guestMaxSeconds: number
  /**
   * Also look for toys through the Lovense Connect app. Off by default because
   * it finds that app through Lovense's own servers, rather than locally.
   */
  lovenseConnect: boolean
  /** Connect when GoonLib starts, rather than waiting to be asked. */
  autoConnect: boolean
}

/** What the host's player is doing, reported so the toy can follow it. */
export interface ToyPlayback {
  /** Null when no video is on screen. */
  mediaId: number | null
  playing: boolean
  positionMs: number
  rate: number
}

/** What an undo or redo of a Delete did. */
export interface TrashUndoResult {
  /** Files that moved. */
  moved: number
  /** Files that could not be moved; nothing was changed for them. */
  failed: number
  canUndo: boolean
  canRedo: boolean
}

/** Outcome of moving a batch of files to a folder the user picked. */
export interface MoveResult {
  /** False when the folder picker was dismissed; nothing was touched. */
  chosen: boolean
  /** Where they went, for the report. */
  destination: string | null
  /** Moved and still in the library, tags and collections intact. */
  rehomed: number
  /** Moved somewhere outside every library folder, so their rows were dropped. */
  dropped: number
  /** Renamed on arrival because that name was already in use there. */
  renamed: number
  /** Already in the destination, so there was nothing to do. */
  skipped: number
  /** Couldn't be moved; the file is wherever it was. */
  failed: number
}

export interface PreparedMedia {
  id: number
  /** The URL to hand to the <video> or <img> element. */
  url: string
  tier: PlaybackTier | null
  /** Why preparation was needed, for the UI to explain a wait. */
  reason: string
}

export interface PrepareProgress {
  id: number
  percent: number
  message: string
}

// ---------------------------------------------------------------------------
// Thread scraping
// ---------------------------------------------------------------------------

export type ScrapePhase =
  | 'idle'
  | 'fetching'
  | 'downloading'
  | 'done'
  | 'cancelled'
  | 'error'

export interface ScrapeProgress {
  phase: ScrapePhase
  url: string | null
  /** The folder name, which is the thread subject or its number. */
  title: string | null
  /** Absolute path files are being written to. */
  folder: string | null
  total: number
  downloaded: number
  /** Already on disk, or a format the library doesn't index. */
  skipped: number
  failed: number
  bytes: number
  message: string | null
}

// ---------------------------------------------------------------------------
// AI categorisation
// ---------------------------------------------------------------------------

/**
 * A label attached to an item. `manual` labels are the user's own filing;
 * `ai` labels are a model's guess and carry the confidence it reported, so the
 * two are never confused for one another.
 */
/** How often an item has been opened in the viewer, and for how long in all. */
export interface MediaViews {
  viewCount: number
  watchMs: number
  lastViewedAt: number | null
  /** Where a video was left, or null when there is nothing to carry on from. */
  positionMs: number | null
}

/** What a photo's EXIF says, read when asked and never stored. */
export interface MediaExif {
  make: string | null
  model: string | null
  lens: string | null
  /** When the photo was taken, as epoch milliseconds. */
  takenAt: number | null
  exposure: string | null
  aperture: string | null
  iso: number | null
  focalLength: string | null
  flash: string | null
  software: string | null
  /** Where it was taken, from its GPS tags; only shown when Settings allow. */
  location: { latitude: number; longitude: number } | null
}

export interface MediaLabel {
  label: string
  source: 'ai' | 'manual'
  /** 0..1 for AI labels, null for manual ones. */
  confidence: number | null
}

/** Everything the classifier produced for one item. */
export interface MediaAnnotations {
  labels: MediaLabel[]
  /** Free-text description, also indexed for search. Null until captioned. */
  caption: string | null
}

/**
 * Where classification requests go.
 *
 * `openai` is any server speaking the OpenAI chat-completions shape — LM Studio,
 * Ollama, vLLM, llama.cpp's server, or a hosted one. It exists mainly so the
 * whole thing can run locally: nothing leaves the machine, there is no per-image
 * cost, and a local model has no safety classifier to decline the request.
 */
export type AiProvider = 'anthropic' | 'openai'

export const AI_PROVIDERS: Array<{ id: AiProvider; label: string; note: string }> = [
  { id: 'anthropic', label: 'Claude API', note: 'Anthropic-hosted. Needs an API key.' },
  {
    id: 'openai',
    label: 'Local or OpenAI-compatible',
    note: 'LM Studio, Ollama, vLLM - anything serving /v1/chat/completions.',
  },
]

/** LM Studio's default server address, which is the common case here. */
export const DEFAULT_BASE_URL = 'http://localhost:1234/v1'

/** Claude models offered in the settings panel. The list is advisory — any id works. */
export const AI_MODELS: Array<{ id: string; label: string; note: string }> = [
  { id: 'claude-opus-5', label: 'Claude Opus 5', note: 'Most capable · $5/$25 per Mtok' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', note: 'Faster, cheaper · $3/$15 per Mtok' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', note: 'Cheapest · $1/$5 per Mtok' },
]

export interface AiSettings {
  enabled: boolean
  provider: AiProvider
  /** Only consulted for the `openai` provider. Must include the `/v1` path. */
  baseUrl: string
  model: string
  /**
   * The vocabulary the model must choose from. Empty means open vocabulary —
   * the model invents its own labels, which is useful for discovering how a
   * library actually breaks down before committing to categories.
   */
  categories: string[]
  /** File every classified item into a collection named after each label. */
  autoSort: boolean
  /** 0..1. Labels below this are still recorded, but never auto-sorted. */
  minConfidence: number
  /** Requests in flight at once. */
  concurrency: number
  /** Videos are classified from their poster frame. Off by default. */
  includeVideos: boolean
  /**
   * Also ask for a written description of each item, stored and indexed for
   * search. Costs more tokens per item than labels alone, and is what makes a
   * captioning model like JoyCaption worth running.
   */
  captions: boolean
}

/**
 * What the renderer is allowed to see. The API key itself never crosses the
 * bridge in either direction except on the one-way `setKey` call.
 */
export interface AiSettingsView extends AiSettings {
  /** True once the selected provider has everything it needs to run. */
  ready: boolean
  apiKeyPresent: boolean
  /**
   * False when the OS keychain refused to encrypt, meaning the key is sitting
   * in the database as plain text. The panel says so rather than implying a
   * safety it doesn't have.
   */
  apiKeyEncrypted: boolean
}

/** Result of the "Test connection" button. */
export interface AiTestResult {
  ok: boolean
  message: string
}

// ---------------------------------------------------------------------------
// Co-watching
// ---------------------------------------------------------------------------

/**
 * How a guest reaches the host. `lan` binds a port on the local network and is
 * enough for two machines in one house; `tunnel` additionally spawns the user's
 * own cloudflared/ngrok to get a public https URL, which is the only way a
 * partner on an ordinary internet connection gets in.
 */
export type CoWatchReach = 'lan' | 'tunnel'

export type CoWatchTunnelState = 'off' | 'starting' | 'up' | 'error'

/**
 * Which tunnel to drive. `auto` takes the first one installed, preferring
 * cloudflared because its quick tunnels need no account; naming one uses only
 * that and reports plainly if it is missing, since being handed a cloudflared
 * URL after asking for ngrok is worse than an error.
 */
export type CoWatchTunnelProvider = 'auto' | 'cloudflared' | 'ngrok'

export interface CoWatchGuest {
  id: string
  /** What they typed on the join page. Never trusted for anything but display. */
  name: string
  /** Where they connected from, so the host knows who they just let in. */
  address: string
  joinedAt: number
  /** Whether they can actually play the current item yet. */
  ready: boolean
  /** Null until the first round trip lands. */
  latencyMs: number | null
  /** False once their event stream drops, before they are dropped entirely. */
  connected: boolean
}

/**
 * Someone holding a valid invite, waiting to be let in. Nothing is served to a
 * knock — the link buys the right to appear here, and no more.
 */
export interface CoWatchKnock {
  id: string
  name: string
  address: string
  /** Two words, shown on both screens, so approval can be confirmed out loud. */
  fingerprint: string
  at: number
}

export interface CoWatchPlayback {
  mediaId: number | null
  paused: boolean
  positionMs: number
  /** Host clock at the moment positionMs was true. */
  updatedAt: number
  /** Who last changed it, so the UI can attribute the change. */
  actor: string
  /** True while the room is held for someone who cannot play yet. */
  waiting: boolean
  /** Names of the people being waited on. */
  waitingFor: string[]
}

/**
 * Who is driving the session, as one participant sees it.
 *
 * One peer is in control at a time. Everyone else asks, and the controller
 * decides; there is no override, host included.
 */
export interface CoWatchControl {
  /** The controller, named for this viewer — "You" when it is them. */
  controller: string
  inControl: boolean
  /** This viewer has asked for control and is waiting on an answer. */
  requested: boolean
  /** Open requests, oldest first. Only the controller is shown them. */
  requests: Array<{ id: string; name: string; at: number }>
}

/**
 * The reactions a session allows, as ids paired with what to draw.
 *
 * A closed set rather than free text: anything sent here is rendered into every
 * participant's page, and an arbitrary string would be an unsanitised payload
 * with no upside. The browser client carries its own copy of the glyphs because
 * it is plain script with no module loader — keep the two in step.
 */
export const COWATCH_REACTIONS: Array<{ id: string; glyph: string }> = [
  { id: 'heart', glyph: '\u2764\uFE0F' },
  { id: 'fire', glyph: '\uD83D\uDD25' },
  { id: 'lol', glyph: '\uD83D\uDE02' },
  { id: 'wow', glyph: '\uD83D\uDE2E' },
  { id: 'eyes', glyph: '\uD83D\uDC40' },
  { id: 'cheer', glyph: '\uD83D\uDE4C' },
  { id: 'love', glyph: '\uD83D\uDE0D' },
  { id: 'splash', glyph: '\uD83D\uDCA6' },
]

export interface CoWatchMessage {
  id: string
  from: string
  text: string
  at: number
}

export interface CoWatchReaction {
  id: string
  from: string
  emoji: string
  at: number
}

/**
 * Everything the host UI needs to render the session. Deliberately the whole
 * picture in one object: sessions change rarely enough that diffing would be
 * more code than it saves.
 */
export interface CoWatchSession {
  active: boolean
  /** The link to hand a guest. Null until the server is actually listening. */
  url: string | null
  invite: string | null
  reach: CoWatchReach
  tunnel: CoWatchTunnelState
  /** Why the tunnel is not up, or how to install one that isn't there. */
  tunnelMessage: string | null
  /** What the user asked for. */
  provider: CoWatchTunnelProvider
  /** Which one actually came up, which need not be what was asked for under `auto`. */
  tunnelKind: string | null
  /** Providers found on this machine, so the panel only offers real choices. */
  available: string[]
  guests: CoWatchGuest[]
  knocking: CoWatchKnock[]
  playback: CoWatchPlayback
  control: CoWatchControl
  chat: CoWatchMessage[]
  /** Media ids queued up next, shared by everyone in the session. */
  queue: number[]
  error: string | null
}

/**
 * A proposed change to what the room is watching. Anyone can send one, but only
 * the controller's are applied; the host process is where that is decided.
 */
export type CoWatchIntent =
  | { kind: 'open'; mediaId: number; positionMs?: number; autoplay?: boolean }
  | { kind: 'play' }
  | { kind: 'pause'; positionMs: number }
  | { kind: 'seek'; positionMs: number }
  | { kind: 'close' }

/** A theme the App Styling page can pick: built in, or a file in themes/. */
export interface ThemeLibraryEntry {
  /** The file name, or builtin:<name> for the ones that come with the app. */
  id: string
  theme: Theme
  builtIn: boolean
}

export interface ThemeState {
  config: ThemeConfig
  library: ThemeLibraryEntry[]
  /** Where saved themes are kept, for "Show folder". */
  folder: string
  /** Files or colours that could not be read, and were skipped. */
  problems: string[]
}

/** A settings backup, as written to a file. Themes come along; filing does not. */
export interface SettingsBackup {
  kind: 'goonlib-settings'
  format: number
  /** The app version that wrote it, for reading a problem report later. */
  version: string
  exportedAt: number
  /** Every stored setting, less the AI key, which is never written out. */
  settings: Record<string, string>
  themes: ThemeConfig
  /** The saved themes, without the built-in ones. */
  library: Theme[]
}

export interface ThemeImport {
  state: ThemeState
  /** Null when the dialog was cancelled. */
  theme: Theme | null
  skipped: string[]
}

/** Channel names. Kept as constants so main and preload can never drift apart. */
export const IPC = {
  appInfo: 'app:info',
  rootsList: 'roots:list',
  rootsAdd: 'roots:add',
  rootsRemove: 'roots:remove',
  rootsSetEnabled: 'roots:set-enabled',
  libraryStats: 'library:stats',
  libraryExtensions: 'library:extensions',
  mediaList: 'media:list',
  mediaGet: 'media:get',
  foldersChildren: 'folders:children',
  collectionsList: 'collections:list',
  collectionsCreate: 'collections:create',
  collectionsRename: 'collections:rename',
  collectionsDelete: 'collections:delete',
  collectionsAdd: 'collections:add',
  collectionsRemove: 'collections:remove',
  collectionsOf: 'collections:of',
  collectionsMove: 'collections:move',
  collectionsSetCover: 'collections:set-cover',
  mediaFileAction: 'media:file-action',
  duplicatesFind: 'duplicates:find',
  duplicatesDistance: 'duplicates:distance',
  duplicatesSetDistance: 'duplicates:set-distance',
  mediaIds: 'media:ids',
  mediaTrash: 'media:trash',
  mediaUndoTrash: 'media:undo-trash',
  mediaRedoTrash: 'media:redo-trash',
  mediaMove: 'media:move',
  revealInFinder: 'media:reveal',
  mediaFavorite: 'media:favorite',
  mediaAnnotations: 'media:annotations',
  mediaViews: 'media:views',
  mediaRecordView: 'media:record-view',
  mediaExif: 'media:exif',
  mediaPosition: 'media:position',
  mediaSetPosition: 'media:set-position',
  mediaContinue: 'media:continue',
  mediaClearHistory: 'media:clear-history',
  mediaForgetPosition: 'media:forget-position',
  tagsList: 'tags:list',
  tagsCreate: 'tags:create',
  tagsRename: 'tags:rename',
  tagsDelete: 'tags:delete',
  tagsAssign: 'tags:assign',
  tagsUnassign: 'tags:unassign',
  aiSettings: 'ai:settings',
  aiUpdate: 'ai:update',
  aiSetKey: 'ai:set-key',
  aiClearKey: 'ai:clear-key',
  aiTest: 'ai:test',
  aiModels: 'ai:models',
  aiReclassify: 'ai:reclassify',
  aiReset: 'ai:reset',
  scrapeStart: 'scrape:start',
  scrapeCancel: 'scrape:cancel',
  scrapeStatus: 'scrape:status',
  scrapeProgress: 'scrape:progress',
  scanStart: 'scan:start',
  scanCancel: 'scan:cancel',
  scanStatus: 'scan:status',
  playbackPrepare: 'playback:prepare',
  playbackCancel: 'playback:cancel',
  playbackPrefs: 'playback:prefs',
  playbackSetPrefs: 'playback:set-prefs',
  /** Main -> renderer pushes. */
  scanProgress: 'scan:progress',
  playbackProgress: 'playback:progress',
  cowatchStatus: 'cowatch:status',
  cowatchStart: 'cowatch:start',
  cowatchStop: 'cowatch:stop',
  cowatchApprove: 'cowatch:approve',
  cowatchKick: 'cowatch:kick',
  cowatchSay: 'cowatch:say',
  cowatchReact: 'cowatch:react',
  cowatchIntent: 'cowatch:intent',
  cowatchReady: 'cowatch:ready',
  cowatchQueue: 'cowatch:queue',
  cowatchRequestControl: 'cowatch:request-control',
  cowatchCancelControl: 'cowatch:cancel-control',
  cowatchAnswerControl: 'cowatch:answer-control',
  cowatchCopy: 'cowatch:copy',
  cowatchTunnels: 'cowatch:tunnels',
  cowatchHostName: 'cowatch:host-name',
  cowatchSetHostName: 'cowatch:set-host-name',
  /** Main -> renderer: the session changed, or a reaction flew past. */
  cowatchUpdate: 'cowatch:update',
  cowatchReaction: 'cowatch:reaction',
  themeState: 'theme:state',
  themeSetMode: 'theme:set-mode',
  themeUse: 'theme:use',
  themeSave: 'theme:save',
  themeRemove: 'theme:remove',
  themeImport: 'theme:import',
  themeExport: 'theme:export',
  themeReveal: 'theme:reveal',
  keysGet: 'keys:get',
  keysReset: 'keys:reset',
  keysSet: 'keys:set',
  settingsExport: 'settings:export',
  settingsImport: 'settings:import',
  /** Main -> renderer: a theme changed, from the app or by a hand edit. */
  themeUpdate: 'theme:update',
  toyStatus: 'toy:status',
  toyConnect: 'toy:connect',
  toyDisconnect: 'toy:disconnect',
  toyScan: 'toy:scan',
  toyStop: 'toy:stop',
  toyResume: 'toy:resume',
  toyManual: 'toy:manual',
  toyPlayback: 'toy:playback',
  toyPreview: 'toy:preview',
  toyPrefs: 'toy:prefs',
  toySetPrefs: 'toy:set-prefs',
  toyCurve: 'toy:curve',
  toyPatternSave: 'toy:pattern-save',
  toyPatternDelete: 'toy:pattern-delete',
  /** Main -> renderer: the toy's status moved. */
  toyUpdate: 'toy:update',
} as const

/** The surface exposed on `window.goonlib` by the preload bridge. */
export interface GoonLibApi {
  app: {
    info(): Promise<AppInfo>
    /**
     * Which platform this is, available without waiting: the window chrome is
     * laid out from it before the first paint.
     */
    platform: Platform
  }
  roots: {
    list(): Promise<Root[]>
    /** Opens a native folder picker in the main process. Resolves null if cancelled. */
    add(): Promise<Root | null>
    remove(id: number): Promise<void>
    setEnabled(id: number, enabled: boolean): Promise<void>
  }
  library: {
    stats(): Promise<LibraryStats>
    /** One item by id, or null if it is not in the library. */
    get(id: number): Promise<MediaItem | null>
    list(query: MediaQuery): Promise<MediaPage>
    /** Every file type in the library, commonest first, for the Filters panel. */
    extensions(): Promise<Array<{ ext: string; count: number }>>
    /**
     * Every matching id in grid order, for selecting things the grid hasn't
     * loaded. Ids only, so this stays cheap on a large library.
     */
    ids(query: Omit<MediaQuery, 'limit' | 'offset'>): Promise<number[]>
  }
  folders: {
    /** Immediate subfolders of `path` within a root. Pass '' for the top level. */
    children(rootId: number, path: string): Promise<FolderNode[]>
  }
  collections: {
    list(): Promise<Collection[]>
    create(name: string): Promise<Collection>
    rename(id: number, name: string): Promise<void>
    remove(id: number): Promise<void>
    /** Appends to the end; items already present keep their place. */
    add(collectionId: number, mediaIds: number[]): Promise<number>
    removeItems(collectionId: number, mediaIds: number[]): Promise<void>
    /** The ids of the collections one item is in. */
    of(mediaId: number): Promise<number[]>
    /** Moves an item to a zero-based index in the collection's order. */
    move(collectionId: number, mediaId: number, toIndex: number): Promise<void>
    setCover(collectionId: number, mediaId: number | null): Promise<void>
  }
  tags: {
    list(): Promise<Tag[]>
    /** Creates a tag, or returns the existing one if the name is taken. */
    create(name: string): Promise<Tag>
    /**
     * Renames a tag. If the new name is already in use the two are merged, and
     * the surviving tag is returned — so the id you get back may not be the one
     * you passed in.
     */
    rename(id: number, name: string): Promise<Tag>
    /** Removes the tag and every assignment of it. Files are untouched. */
    remove(id: number): Promise<void>
    /** Attaches a tag to items as the user's own, overriding an AI guess. */
    assign(tagId: number, mediaIds: number[]): Promise<number>
    unassign(tagId: number, mediaIds: number[]): Promise<void>
  }
  scrape: {
    /**
     * Downloads a 4chan thread's images and videos into a folder under
     * Downloads, adds that folder as a library source, and scans it.
     *
     * Resolves once every file has been tried. Re-running the same thread only
     * fetches what isn't already there.
     */
    start(url: string): Promise<ScrapeProgress>
    cancel(): Promise<void>
    status(): Promise<ScrapeProgress>
    onProgress(listener: (progress: ScrapeProgress) => void): () => void
  }
  scan: {
    /** Starts a scan of every enabled root, or just one. Resolves immediately. */
    start(rootId?: number): Promise<void>
    cancel(): Promise<void>
    status(): Promise<ScanProgress>
    /** Subscribes to progress pushes. Returns an unsubscribe function. */
    onProgress(listener: (progress: ScanProgress) => void): () => void
  }
  duplicates: {
    /** Without a distance, uses the one chosen in settings. */
    find(distance?: number): Promise<DuplicateReport>
    /** How alike two images must look to count as near-duplicates. */
    distance(): Promise<number>
    /** Resolves with the distance as stored, held to what can be found reliably. */
    setDistance(distance: number): Promise<number>
  }
  media: {
    /**
     * Moves files to the system Trash. Resolves with the number actually
     * removed — zero if the user cancelled. Never deletes permanently.
     *
     * Confirms by default. `confirm: false` is for the paths that are already
     * an unambiguous instruction on their own: the Delete key, and the
     * single-item context menu. The Trash buttons keep the dialog, since a
     * pointer can find them by accident in a way a keystroke cannot.
     */
    trash(mediaIds: number[], options?: { confirm?: boolean }): Promise<number>
    /**
     * Puts the last Delete back where it came from, out of the system Trash.
     * Files emptied from the Trash since, or with something new in their old
     * place, are counted as failed and left alone.
     */
    undoTrash(): Promise<TrashUndoResult>
    /** Trashes again what the last undo put back. */
    redoTrash(): Promise<TrashUndoResult>
    /**
     * Asks for a destination folder, then moves the files there. Landing inside
     * a library folder keeps the item and everything attached to it; landing
     * outside means it has left the library, and its row goes too.
     */
    move(mediaIds: number[]): Promise<MoveResult>
    /**
     * Favorites or unfavorites items. Resolves with how many changed; items
     * already in the requested state are left alone, timestamp included.
     */
    favorite(mediaIds: number[], favorite: boolean): Promise<number>
    /** Opens the enclosing folder and selects the file. */
    reveal(mediaId: number): Promise<void>
    /** Pops up the native right-click menu for an item. */
    /**
     * One of the right-click menu's actions that only the main process can do:
     * the clipboard, the Finder, the Trash. False when there was nothing to
     * act on, such as a file that has gone missing.
     */
    fileAction(action: MediaFileAction, mediaId: number): Promise<boolean>
    /** Labels and caption for one item; labels are best-guess first. */
    annotations(mediaId: number): Promise<MediaAnnotations>
    /** How often the item has been viewed, and for how long in all. */
    views(mediaId: number): Promise<MediaViews>
    /** Counts one viewing, and the milliseconds it lasted. Fire and forget. */
    recordView(mediaId: number, watchedMs: number): void
    /** A photo's EXIF, or null when it has none. */
    exif(mediaId: number): Promise<MediaExif | null>
    /** Where to carry a video on from, or null. */
    position(mediaId: number): Promise<number | null>
    /** Notes where a video is now. Fire and forget. */
    setPosition(mediaId: number, positionMs: number, durationMs: number): void
    /** Videos left part-way through, most recently left first. */
    continueWatching(limit: number): Promise<MediaItem[]>
    /** Forgets every count, time watched and position. Resolves with the rows dropped. */
    clearHistory(): Promise<number>
    /** Takes one video off Continue watching, leaving its counts alone. */
    forgetPosition(mediaId: number): Promise<void>
  }
  ai: {
    settings(): Promise<AiSettingsView>
    /** Applies a partial change and returns the settings as they now stand. */
    update(patch: Partial<AiSettings>): Promise<AiSettingsView>
    /**
     * Hands the key to the main process, which encrypts it with the OS keychain
     * where possible. There is deliberately no way to read it back.
     */
    setKey(key: string): Promise<AiSettingsView>
    clearKey(): Promise<AiSettingsView>
    /** Sends one trivial request to confirm the key and model actually work. */
    test(): Promise<AiTestResult>
    /**
     * Model ids the configured server is offering. Only an OpenAI-compatible
     * server can be asked; for the Claude API this resolves to the built-in list.
     */
    models(): Promise<string[]>
    /**
     * Queues items for classification and starts a scan. `all` re-runs items
     * that already have labels; otherwise only never-classified items are
     * queued. Resolves with the number queued.
     */
    reclassify(all: boolean): Promise<number>
    /**
     * Takes back everything the classifier filed, after a confirmation. Null
     * when that was turned down; otherwise what went.
     */
    reset(): Promise<{ tags: number; collections: number; items: number } | null>
  }
  playback: {
    /**
     * Resolves once the item can actually be played — immediately for native
     * files, after a remux or transcode otherwise.
     */
    prepare(id: number): Promise<PreparedMedia>
    cancel(id: number): Promise<void>
    onProgress(listener: (progress: PrepareProgress) => void): () => void
    prefs(): Promise<PlaybackPrefs>
    /** Applies a partial change and returns the preferences as they now stand. */
    setPrefs(patch: Partial<PlaybackPrefs>): Promise<PlaybackPrefs>
  }
  cowatch: {
    status(): Promise<CoWatchSession>
    /** Which tunnel binaries are installed, refreshed each time the panel opens. */
    tunnels(): Promise<string[]>
    /** What guests see the host called. */
    hostName(): Promise<string>
    /** Renames the host, and resolves with the name as stored; empty means the default. */
    setHostName(name: string): Promise<string>
    /**
     * Opens the session server. With `tunnel` it also launches the user's own
     * cloudflared or ngrok; the returned session says whether that worked, and
     * the URL is only non-null once something is actually reachable.
     */
    start(reach: CoWatchReach, provider?: CoWatchTunnelProvider): Promise<CoWatchSession>
    /**
     * Ends everything at once: sockets dropped, cookies invalidated, port
     * closed, tunnel process killed. There is no half-shared state to clean up
     * afterwards.
     */
    stop(): Promise<CoWatchSession>
    /** Lets a knock in, or turns it away. Nothing is served before this. */
    approve(knockId: string, allow: boolean): Promise<CoWatchSession>
    kick(guestId: string): Promise<CoWatchSession>
    say(text: string): Promise<void>
    react(emoji: string): Promise<void>
    /** The host's own player proposing a change. Ignored unless the host is in control. */
    intent(intent: CoWatchIntent): Promise<void>
    /** Asks whoever is in control to hand it to the host. */
    requestControl(): Promise<void>
    cancelControlRequest(): Promise<void>
    /** The host, while in control, answering someone's request for it. */
    answerControl(peerId: string, allow: boolean): Promise<void>
    /** The host's player reporting whether it can play the current item. */
    ready(mediaId: number, ready: boolean): Promise<void>
    setQueue(mediaIds: number[]): Promise<void>
    /**
     * Puts the invite link on the clipboard.
     *
     * Done in the main process because the renderer's Clipboard API is behind a
     * permission this app denies wholesale. The renderer passes no string: the
     * main process copies the URL it already holds, so this cannot be used to
     * write arbitrary content to the clipboard.
     */
    copyInvite(): Promise<boolean>
    onUpdate(listener: (session: CoWatchSession) => void): () => void
    onReaction(listener: (reaction: CoWatchReaction) => void): () => void
  }
  keys: {
    /** Every shortcut as it stands, defaults included. */
    get(): Promise<KeyBindings>
    /** Sets one action's keys, or clears them with an empty list. Resolves with them all. */
    set(actionId: string, keys: string[]): Promise<KeyBindings>
    /** Puts every shortcut back to its default. */
    reset(): Promise<KeyBindings>
  }
  settings: {
    /** Writes settings and themes to a file. False when the dialog was cancelled. */
    export(): Promise<boolean>
    /**
     * Reads settings and themes back, after asking. False when the dialog or
     * the question was turned down.
     */
    import(): Promise<boolean>
  }
  theme: {
    /** The themes as they stood when the window opened, for its first paint. */
    initial: ThemeState
    state(): Promise<ThemeState>
    setMode(mode: ThemeMode): Promise<ThemeState>
    /** Makes a theme the one for a side without saving it to the library. */
    use(side: ThemeType, theme: Theme): Promise<ThemeState>
    /** Saves to the library under the theme's name, and makes it the one for `side`. */
    save(side: ThemeType, theme: Theme): Promise<ThemeState>
    /** Moves a saved theme's file to the Trash. */
    remove(id: string): Promise<ThemeState>
    import(): Promise<ThemeImport>
    /** Resolves false when the dialog was cancelled. */
    export(theme: Theme): Promise<boolean>
    revealFolder(): Promise<void>
    onUpdate(listener: (state: ThemeState) => void): () => void
  }
  toy: {
    status(): Promise<ToyStatus>
    /**
     * Starts the engine if need be — downloading it the first time — connects,
     * and looks for toys. Resolves with the status once that has settled; a
     * failure is reported in the status rather than thrown.
     */
    connect(): Promise<ToyStatus>
    /** Stops the toy, disconnects, and shuts down the engine GoonLib started. */
    disconnect(): Promise<ToyStatus>
    /** Looks for toys again, for one switched on after connecting. */
    scan(): Promise<ToyStatus>
    /** Stops everything at once and stays stopped until `resume`. */
    stop(): Promise<ToyStatus>
    resume(): Promise<ToyStatus>
    /** Runs a pattern from the panel, or stops it with null. */
    manual(manual: ToyManual | null): Promise<ToyStatus>
    /** The player saying what it is doing. Fire and forget. */
    playback(state: ToyPlayback): void
    /**
     * Plays one level on the toy while an intensity slider is being moved, and
     * stops with null. Fire and forget, and dropped by the main process if the
     * window stops saying so.
     */
    preview(level: number | null): void
    prefs(): Promise<ToyPrefs>
    setPrefs(patch: Partial<ToyPrefs>): Promise<ToyPrefs>
    /**
     * The current video's script, as strength across its length in `points`
     * steps, for drawing. Null when the script loaded is not for this video.
     */
    curve(mediaId: number, durationMs: number, points: number): Promise<number[] | null>
    /**
     * Saves a drawn pattern, new or edited, and resolves with it as stored —
     * cleaned up, and with its id. A running copy picks the change up at once.
     */
    savePattern(draft: CustomPatternDraft): Promise<CustomPattern>
    /** Deletes a saved pattern, stopping it first if it is the one running. */
    deletePattern(id: number): Promise<ToyStatus>
    onUpdate(listener: (status: ToyStatus) => void): () => void
  }
}
