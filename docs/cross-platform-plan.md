# Windows and Linux

Written 2026-09-23 against 0.9.4 as a plan, and carried out in 0.9.8 - the last change
before beta, as it was scheduled to be.

## Where we already stood

- `electron-builder.yml` declared a Windows target (NSIS) and a Linux one (AppImage),
  both with icons, alongside the mac DMG.
- The Intiface engine download carried checksums for `win32-x64`, `linux-x64` and
  `linux-arm64`, and the engine is made executable on the platforms that need it.
- Paths are stored with forward slashes whatever the platform (`toPosix` in the walker),
  so a library is portable.
- Keyboard shortcuts already accepted Ctrl wherever they accepted Cmd.
- `shell.trashItem`, `shell.showItemInFolder` and the media protocol were already
  cross-platform.

## 1. Chrome and wording - done

The renderer learns the platform from the bridge (`window.goonlib.app.platform`,
wrapped by `src/renderer/src/platform.ts`) and writes it onto `<html>` before the first
paint, so the stylesheet can lay the chrome out for it.

- **Traffic-light clearance** is now `--chrome-top` / `--chrome-top-brand`, 34/38px on
  macOS and ordinary padding elsewhere, and the drag regions over the toolbar, the
  sidebar brand and the duplicates bar are dropped off macOS, where the window's own
  title bar does that job.
- **The application menu.** Electron's default menu would have shown File/Edit/View/
  Window/Help - and Reload and Toggle DevTools - inside the window on Windows and Linux.
  Those two get a short one instead (`installAppMenu`), hidden behind Alt, holding only
  quit, close, the editing keys, fullscreen and the version. macOS keeps Electron's
  default, which is where its About panel and Cmd+C live.
- **Wording.** "Reveal in Finder" reads "Show in Explorer" or "Show in file manager";
  the Trash is the Recycle Bin on Windows, in the menus, the selection bar, the
  duplicates page and the shortcuts list; "Copy" is hidden off macOS, where it would be
  a second name for "Copy File Path"; the cloudflared install command is the one for
  this platform, and Linux is told to find it rather than given a command that is wrong
  on most distributions.
- **Fonts.** The stack already named Segoe UI and system-ui. Left as it is.

## 2. Build on each platform - done

`.github/workflows/release.yml`: the suite runs once on Linux, then macOS, Windows and
Linux each build their own `npm run dist` on a runner of their own, because the three
native pieces - better-sqlite3 rebuilt against Electron's ABI, sharp, and the bundled
ffmpeg/ffprobe - cannot be cross-built from one machine with any confidence.

- A `v*` tag builds all three and attaches them to a draft release; running the workflow
  by hand builds the same artifacts and keeps them for a week without publishing, which
  is how a change to the workflow gets tested.
- That also gives Intel Mac builds without this machine doing the work.
- `npmRebuild: true` stays; it is what makes better-sqlite3 match Electron.
- The NSIS installer asks where to install rather than being one-click.

## 3. Platform behaviour - done as far as it is worth

- **Undo after a delete.** `trash.ts` finds a trashed file again by device and inode, in
  the macOS Trash or the freedesktop one. Windows' Recycle Bin does not work that way
  and is not worth a native helper, so undo there now says the files stayed in the
  Recycle Bin and are to be put back from there - rather than the old message, which
  claimed they were gone or replaced.
- **Copy.** Real files reach the clipboard only on macOS, through
  `NSFilenamesPboardType`. Elsewhere the menu offers the path instead and says so.
  Windows would want `CF_HDROP`, which Electron does not expose.
- **Bluetooth.** macOS has its usage string; Windows needs nothing; a Linux machine
  whose BlueZ is not running is told to start the bluetooth service rather than being
  shown a D-Bus error.
- **Firewall.** Watch Together binds a port, so Windows prompts the first time a session
  starts. The panel says so before the button is pressed.
- **ffmpeg on PATH.** The fallback lookup ran `/usr/bin/env which`, which does not exist
  on Windows; it runs `where` there now, and the "install it" message names the right
  package manager.
- **Tunnels on PATH.** A packaged app inherits a thin PATH, so the search already looked
  in the Homebrew and MacPorts directories; it looks in the winget and chocolatey ones
  on Windows.

## 4. Signing - not done, and deliberately

- **Windows:** unsigned installers get a SmartScreen warning. A certificate costs a few
  hundred a year. Shipping unsigned first, and seeing whether anyone minds.
- **macOS:** unsigned as well; a Developer ID and notarisation would remove the
  Gatekeeper warning.
- **Linux:** AppImage needs nothing.

## Still untested

Everything above is written and typechecked, and the mac build is the one that has been
run. Neither the Windows nor the Linux build has been started on real hardware, and
until one has, both count as unproven - the first CI run is the test.
