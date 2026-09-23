# Windows and Linux: the plan

Scheduled as the **last change before beta**, after the features are settled. The work is
mostly presentation and packaging, and doing it earlier means redoing it every time the
window chrome or the menus change.

Written 2026-09-23, against 0.9.4.

## Where we already stand

- `electron-builder.yml` declares a Windows target (NSIS) and a Linux one (AppImage),
  both with icons, alongside the mac DMG.
- The Intiface engine download carries checksums for `win32-x64`, `linux-x64` and
  `linux-arm64`, and the engine is made executable on the platforms that need it.
- Paths are stored with forward slashes whatever the platform (`toPosix` in the walker),
  so a library is portable.
- Keyboard shortcuts already accept Ctrl wherever they accept Cmd.
- `shell.trashItem`, `shell.showItemInFolder` and the media protocol are cross-platform
  as they stand.

## 1. Chrome and wording (half a day)

The app is dressed for macOS. Nothing here is hard; it is a pass over the places that
assume a Mac.

- **Traffic-light clearance.** The toolbar, the viewer's bar and the sidebar's brand row
  all reserve 34px at the top for the macOS window buttons (`titleBarStyle: hiddenInset`).
  On Windows and Linux that is a bare strip, and the window's own buttons sit top right.
  Either give those platforms a frameless window with our own buttons, or drop the inset,
  the drag strip (`.toolbar__drag`) and the padding when `process.platform !== 'darwin'`.
- **"Reveal in Finder"** in the right-click menu should read "Show in Explorer" on
  Windows and "Show in file manager" on Linux.
- **Fonts.** The stack already names Segoe UI and system-ui; check it reads well on both
  before deciding to ship a font.
- **The About panel** is set through `app.setAboutPanelOptions`, which is macOS only.
  Windows and Linux need their own small About, or none.

## 2. Build on each platform (half a day)

The blocker. Three native pieces — better-sqlite3 (rebuilt against Electron's ABI),
sharp, and the bundled ffmpeg/ffprobe — cannot be cross-built from a Mac with any
confidence.

- A GitHub Actions workflow, matrix over `macos-latest`, `windows-latest` and
  `ubuntu-latest`, running `npm ci && npm run dist` on a `v*` tag and attaching the
  results to the release.
- That also gives Intel Mac builds without this machine doing the work.
- Keep `npmRebuild: true`; it is what makes better-sqlite3 match Electron.
- Watch the artifact size: ffmpeg and sharp are most of it.

## 3. Platform behaviour that is missing or worse (a day, and optional)

- **Undo after a delete.** `trash.ts` finds a trashed file again by device and inode, in
  the macOS Trash or the freedesktop one. Windows' Recycle Bin works differently, so undo
  there reports that it could not bring the file back. Either implement the Recycle Bin
  path (a PowerShell call, or a small native helper) or say plainly in the UI that undo is
  not available on Windows.
- **Copy.** Real files reach the clipboard only on macOS, through
  `NSFilenamesPboardType`. Elsewhere the path is copied as text, which is useful but not
  the same. Windows would want `CF_HDROP`, which Electron does not expose.
- **Bluetooth.** macOS has its usage string; Windows needs nothing; Linux needs BlueZ
  running, and deserves a clear message when it is not rather than a timeout.
- **Firewall.** Watch Together binds a port, so Windows prompts the first time a session
  starts. Worth a line in the UI so the prompt is expected.

## 4. Signing (money, not time)

- **Windows:** unsigned installers get a SmartScreen warning. A certificate costs a few
  hundred a year. Fine to ship unsigned first and see whether anyone minds.
- **macOS:** unsigned today as well; a Developer ID and notarisation would remove the
  Gatekeeper warning.
- **Linux:** AppImage needs nothing.

## Order

1. Chrome and wording, so the app does not look transplanted.
2. CI builds, so releases carry all three.
3. Platform behaviour, as far as it is worth it.
4. Signing, when someone complains.
