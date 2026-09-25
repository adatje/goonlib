/**
 * Learning that a newer GoonLib exists, and becoming it.
 *
 * The repository is public, so this reads its releases over plain HTTPS with no
 * token compiled into the app. Releases are published by hand from a draft, and
 * the updater only ever sees published ones - an accidental tag cannot ship
 * itself to everyone.
 *
 * Two things it deliberately does not do. It never downloads without being
 * asked: an update is someone else's bandwidth. And on a build macOS has not
 * signed it does not pretend it can install one - Squirrel.Mac refuses to
 * replace an app with no valid signature - so it says what is out and offers the
 * release page instead. Windows and Linux install unsigned without complaint.
 */

import { app, BrowserWindow, shell } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateState } from '@shared/types'

const { autoUpdater } = electronUpdater

/** Where a manual update is fetched from, when this build cannot install one. */
const RELEASES = 'https://github.com/adatje/goonlib/releases/latest'

/** Long enough after launch that a scan and first paint are never held up. */
const FIRST_CHECK_MS = 8_000

/**
 * macOS will not install an update into an unsigned app, and nothing is signed
 * yet (docs/cross-platform-plan.md). Rather than let the download finish and
 * fail at the last step, such a build only ever reports what is available.
 */
function canInstall(): boolean {
  return process.platform !== 'darwin'
}

class Updates {
  private state: UpdateState = { kind: 'idle', version: app.getVersion() }
  private window: BrowserWindow | null = null
  private started = false

  /** Called once the window is up; `automatic` decides whether to look unasked. */
  start(window: BrowserWindow, automatic: boolean): void {
    this.window = window
    if (this.started) return
    this.started = true

    // Unpackaged, there is nothing to replace: electron-updater throws rather
    // than no-op, so it is never wired up in development.
    if (!app.isPackaged) {
      this.set({ kind: 'unsupported', version: app.getVersion(), reason: 'development build' })
      return
    }

    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = null

    /*
     * Every GoonLib release is marked pre-release while the app is in beta.
     * Left at its default, electron-updater walks the releases feed looking for
     * one that is not, finds nothing, and reports that it cannot find a latest
     * version at all - which reads as a broken updater rather than as a beta.
     */
    autoUpdater.allowPrerelease = true

    autoUpdater.on('checking-for-update', () => this.set({ kind: 'checking', version: app.getVersion() }))
    autoUpdater.on('update-not-available', () => this.set({ kind: 'none', version: app.getVersion() }))
    autoUpdater.on('update-available', (info) =>
      this.set({
        kind: canInstall() ? 'available' : 'manual',
        version: app.getVersion(),
        newVersion: info.version,
        url: RELEASES,
      }),
    )
    autoUpdater.on('download-progress', (progress) =>
      this.set({
        kind: 'downloading',
        version: app.getVersion(),
        percent: Math.round(progress.percent),
      }),
    )
    autoUpdater.on('update-downloaded', (info) =>
      this.set({ kind: 'ready', version: app.getVersion(), newVersion: info.version }),
    )
    autoUpdater.on('error', (err) =>
      this.set({ kind: 'error', version: app.getVersion(), message: summarise(err) }),
    )

    if (automatic) setTimeout(() => void this.check(), FIRST_CHECK_MS)
  }

  current(): UpdateState {
    return this.state
  }

  /** Looks now, whatever the setting says. */
  async check(): Promise<UpdateState> {
    if (!app.isPackaged) return this.state
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      this.set({ kind: 'error', version: app.getVersion(), message: summarise(err) })
    }
    return this.state
  }

  /** Fetches the update that was found. On a build that cannot install, opens the page. */
  async download(): Promise<UpdateState> {
    if (this.state.kind === 'manual') {
      void shell.openExternal(this.state.url ?? RELEASES)
      return this.state
    }
    if (this.state.kind !== 'available') return this.state
    try {
      await autoUpdater.downloadUpdate()
    } catch (err) {
      this.set({ kind: 'error', version: app.getVersion(), message: summarise(err) })
    }
    return this.state
  }

  /**
   * Quits and comes back as the new version. Everything the app owns is shut
   * down by the before-quit handler first, exactly as on a normal quit.
   */
  install(): void {
    if (this.state.kind !== 'ready') return
    setImmediate(() => autoUpdater.quitAndInstall())
  }

  private set(state: UpdateState): void {
    this.state = state
    if (!this.window?.isDestroyed()) this.window?.webContents.send('updates:update', state)
  }
}

export const updates = new Updates()

/** As much of a failure as is worth putting on screen. */
const MAX_MESSAGE = 200

/**
 * Turns an updater failure into one line.
 *
 * electron-updater puts the whole HTTP response in the message when it cannot
 * make sense of the releases feed - GitHub's headers alone run to several
 * kilobytes of content-security-policy - and that went into the IPC message and
 * out onto the settings panel verbatim. The first line is the part that says
 * anything; the rest is kept out of the renderer entirely, and logged here for
 * anyone actually debugging it.
 */
function summarise(err: unknown): string {
  const full = err instanceof Error ? err.message : String(err)
  console.error('[updates]', full)

  const first = full.split('\n')[0]?.trim() ?? ''
  // The response body is pasted in after the message proper, so anything that
  // looks like the start of headers or a document ends the useful part.
  const cut = first.split(/,\s*"?(?:content-type|date|server|status)"?:| XML: | HTML: /i)[0]?.trim() ?? first
  const short = cut || full.slice(0, MAX_MESSAGE)
  return short.length > MAX_MESSAGE ? `${short.slice(0, MAX_MESSAGE - 1)}…` : short
}
