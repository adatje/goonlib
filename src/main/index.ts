import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, session, shell } from 'electron'
import { ensureCacheDirs } from './cache'
import { cowatch } from './cowatch'
import { closeDb, initDb } from './db'
import { registerIpc } from './ipc'
import { playbackPrefs } from './db/settings'
import { installAppMenu } from './menu'
import { MEDIA_SCHEME, registerMediaProtocol, registerMediaScheme } from './protocol'
import { indexer } from './scan/indexer'
import { themes } from './theme'
import { updates } from './updates'
import { toys } from './toy'

// Privileged schemes must be declared before the app is ready, so this runs at
// module load rather than inside whenReady().
registerMediaScheme()

const isDev = Boolean(process.env['ELECTRON_RENDERER_URL'])

/**
 * In dev, Vite injects an inline React Refresh preamble and talks to its HMR server
 * over a websocket, so script-src and connect-src have to be loosened. Production
 * gets the strict policy — that's the one that actually ships.
 */
function contentSecurityPolicy(): string {
  const directives = [
    "default-src 'self'",
    isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${MEDIA_SCHEME}:`,
    `media-src 'self' blob: ${MEDIA_SCHEME}:`,
    "font-src 'self' data:",
    isDev ? "connect-src 'self' ws: http://localhost:*" : "connect-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ]
  return directives.join('; ')
}

function applySecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy()],
      },
    })
  })

  // Nothing in this app needs camera, mic, geolocation, or notifications.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
}

/**
 * Surfaces renderer console output and window lifecycle in the dev terminal.
 * Without this, a renderer-side error or an unexpected window move is invisible
 * unless you happen to have DevTools open at the moment it happens.
 */
function attachDevDiagnostics(window: BrowserWindow): void {
  window.on('move', () => console.log('[win] move', window.getBounds()))
  window.on('resize', () => console.log('[win] resize', window.getBounds()))
  window.on('hide', () => console.log('[win] hide'))
  window.on('minimize', () => console.log('[win] minimize'))
  window.on('close', () => console.log('[win] close'))
  window.on('enter-full-screen', () => console.log('[win] enter-full-screen'))
  window.on('leave-full-screen', () => console.log('[win] leave-full-screen'))

  window.webContents.on('render-process-gone', (_event, details) =>
    console.log('[renderer] process gone', details),
  )
  window.webContents.on('unresponsive', () => console.log('[renderer] unresponsive'))
  window.webContents.on('preload-error', (_event, path, error) =>
    console.log('[preload] error', path, error.message),
  )

  // Electron 43 passes a details object; older signatures pass positional args.
  window.webContents.on('console-message', (...args: unknown[]) => {
    const details = args[1] as { message?: string; level?: string } | string | undefined
    if (typeof details === 'object' && details?.message !== undefined) {
      console.log(`[renderer:${details.level ?? 'log'}]`, details.message)
    } else {
      console.log('[renderer]', args.slice(1).join(' '))
    }
  })
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: themes.windowBackground(),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // Windows and Linux draw the menu bar inside the window. Ours holds only
    // the keys people expect to work, so it stays out of sight until Alt.
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      // Chromium's hardware video decoder is the whole reason we're on Electron.
      backgroundThrottling: false,
    },
  })

  // Avoid the white flash before React paints.
  window.once('ready-to-show', () => window.show())

  // Also honoured in a built app, so playback can be traced without running the
  // watching dev server — which restarts the app mid-playback and looks exactly
  // like a bug in the player.
  if (isDev || process.env['GOONLIB_TRACE_MEDIA']) attachDevDiagnostics(window)

  // Any attempt to open a new window goes to the real browser instead.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Block in-place navigation away from the app.
  window.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url)
    const rendererUrl = process.env['ELECTRON_RENDERER_URL']
    const allowed = rendererUrl ? new URL(rendererUrl).origin : null
    if (target.origin !== allowed) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

/**
 * A packaged app takes its icon from the bundle, but an unpackaged one shows the
 * generic Electron icon — which makes it easy to confuse a dev instance with a
 * real one while testing.
 */
function applyDevDockIcon(): void {
  if (app.isPackaged || process.platform !== 'darwin') return

  const icon = join(__dirname, '../../build/icon.png')
  if (!existsSync(icon)) return

  try {
    app.dock?.setIcon(icon)
  } catch {
    // Cosmetic only — never worth failing startup over.
  }
}

/** Who made it, as the About window shows it. */
const AUTHOR = '@Adatje'

app.whenReady().then(async () => {
  applyDevDockIcon()
  // macOS only; the other two get a short menu of their own instead.
  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({
      applicationName: 'GoonLib',
      applicationVersion: app.getVersion(),
      credits: `Author: ${AUTHOR}`,
      copyright: `Copyright © 2026 ${AUTHOR}`,
    })
  }
  installAppMenu()
  initDb()
  ensureCacheDirs()
  applySecurityPolicy()
  registerMediaProtocol()
  // Before the window, so it opens in the right colours rather than flashing Midnight.
  await themes.init()
  registerIpc()

  const window = createWindow()

  // Catch up on anything that changed while the app was closed. The scan is
  // incremental — unchanged files keep their thumbnails and hashes — so this is
  // cheap after the first run. Deferred until the window is up so it never
  // competes with first paint.
  window.webContents.once('did-finish-load', () => {
    // Catches up on what changed while the app was closed, but never
    // classifies: nothing says the model is up a second after launch.
    setTimeout(() => indexer.start(undefined, { classify: false }), 1200)
    updates.start(window, playbackPrefs().autoUpdate)
    // Only when asked for: connecting starts a Bluetooth scan, which is not
    // something to do unprompted on every launch.
    void toys.autoConnect()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  // Stop mid-flight ffmpeg work before tearing the database out from under it.
  indexer.cancel()
  // Quitting must close the port, revoke every guest credential, and kill the
  // tunnel process. A share that outlives the app would be the worst possible
  // failure mode for this feature.
  void cowatch.stop()
  // A toy left running after the app has gone is the one failure this
  // feature must never have.
  toys.shutdown()
  closeDb()
})
