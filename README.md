<div align="center">

<img src="build/icon.png" width="128" alt="GoonLib">

# GoonLib

**A local-first media library for images and video.**

Point it at the folders you already have. It reads them where they sit, works out
what is in them, and leaves them alone — nothing is copied, renamed or moved unless
you ask, and nothing ever leaves the machine.

![Licence](https://img.shields.io/badge/licence-Apache%202.0-ff5c8a?style=flat-square)
![Platforms](https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-ff5c8a?style=flat-square)
![Electron](https://img.shields.io/badge/Electron-2b2e3a?style=flat-square&logo=electron)
![React](https://img.shields.io/badge/React-2b2e3a?style=flat-square&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-2b2e3a?style=flat-square&logo=typescript)
![SQLite](https://img.shields.io/badge/SQLite-2b2e3a?style=flat-square&logo=sqlite)

</div>

---

## What it does

- **Indexes what you point it at.** Probes with ffprobe, makes thumbnails and hover-scrub
  previews, and picks up where it left off if it is interrupted. A drive that is unplugged
  is remembered rather than forgotten, and reattaches on the next scan.
- **Plays almost anything.** Chromium decodes what it can; MKV and other awkward containers
  are remuxed, and codecs it cannot handle (HEVC, VC-1, ProRes) are transcoded in the
  background and cached.
- **Finds duplicates.** Exact matches by content hash, near matches by perceptual hash —
  the same clip at two resolutions, or a screenshot of one, still land together.
- **Sorts however you like.** Collections and tags by hand, or by a vision model if you want
  one. Filters narrow the library by tag, file type, length and size.
- **Remembers where you were.** Videos resume where you left them, and the ones you are
  part-way through sit in a row above the library. It can be switched off, and cleared.
- **Looks how you want.** Themes are plain JSON files you can edit, import and share, with
  four built in. The whole interface follows them, including a guest's browser.
- **Stays out of the way.** Every shortcut is rebindable, the `?` key lists them, and your
  settings and themes can be backed up to a file and restored.
- **Watches with someone.** See below.
- **Drives a toy.** See below.

---

## Getting it

Downloads are on the [releases page](../../releases): a `.dmg` for macOS on Apple Silicon
or Intel, an installer for Windows, and an AppImage for Linux.

Nothing is signed yet, so the first launch needs a click past the warning — on macOS,
right-click the app and choose Open; on Windows, More info then Run anyway. After that it
opens normally.

---

## Watching together

Start a session and hand someone a link. They open it in a browser — no install — and
watch with you, in step: play, pause and seek are shared.

- **Getting in.** The link only buys the right to knock. Both screens show the same two
  words; you approve the person after checking they see them. Nothing is served before
  that.
- **Who drives.** One person is in control at a time, and it starts with you. Anyone
  else can ask; only whoever is in control can hand it over — you included, once you have
  given it away. If the person in control leaves or is removed, it comes back to you.
- **Coming back.** A guest who reloads, reopens the link, or whose phone slept goes
  straight back in without being approved again, for as long as the session runs. Someone
  who has gone quiet stops holding up playback until they return.
- **What they can reach.** Everything you can — the full grid, search, folders, tags.
  A session is read-only against your library: there is no route that trashes, moves,
  renames or re-tags anything.
- **Staying in step.** Small drifts are smoothed by playing a few percent fast or slow;
  only a real gap causes a visible seek. Playback is held whenever anyone cannot play
  yet, which matters because a file that plays natively for you may still be transcoding
  for them.
- **Ending it.** One button closes the port, revokes every credential, and kills the
  tunnel. Quitting the app does the same.

Reaching a guest who is not on your network needs a tunnel you already have:

```bash
brew install cloudflared                      # macOS
winget install --id Cloudflare.cloudflared    # Windows
```

`cloudflared` quick tunnels need no account. `ngrok` works too. Neither is bundled —
GoonLib runs whichever it finds and stops it when the session ends.

---

## Toys

Connect a toy from the wave button at the top of the sidebar. It works over Bluetooth
or the Lovense USB dongle, through the [Intiface](https://intiface.com) engine. The engine
is downloaded the first time you connect (about 6 MB, from the Buttplug.io GitHub release)
and checked against a pinned SHA-256. If Intiface Central is already running, GoonLib uses
that instead.

Four things can drive the toy. Whichever is strongest at any moment wins:

- **Funscripts.** A `.funscript` with the same name as a video, in the same folder,
  plays in step with it — pause, seek and playback speed included. A stroker follows
  the strokes. A vibrator buzzes harder for faster strokes, or deeper ones if you prefer.
- **The soundtrack.** A video with no script can follow its own loudness instead. The
  audio is read once per file and cached.
- **Patterns** from the panel: steady, pulse, wave, build, burst.
- **Guests.** In a Watch together session, guests can send you a buzz, if you have
  turned that on. There's a ceiling on strength and length, a cooldown per guest, and a
  cap on how much can be queued.

One ceiling covers all four. **Stop** — in the panel, in the viewer, or the X key
anywhere — stops everything and stays stopped until you resume. Quitting the app stops
the toy too.

On macOS, GoonLib needs Bluetooth permission (System Settings → Privacy & Security →
Bluetooth). On Linux it goes through BlueZ, so the `bluetooth` service has to be running.
Windows needs nothing.

---

## Known gaps

Two things are macOS-only, for want of an equivalent elsewhere: copying a file itself to
the clipboard (other platforms copy its path), and putting a deleted file back with
Ctrl+Z — Windows' Recycle Bin does not say where it put a file, so undo there points you
at the Recycle Bin instead.

---

## For developers

Electron + React + SQLite. Requires Node 22.

```bash
npm install
npm run dev
```

Running from a terminal, it is the terminal app that macOS asks to allow Bluetooth for,
not GoonLib.

```bash
npm test          # vitest, no app window required
npm run typecheck # two tsc projects, main/preload/shared and renderer
npm run dist      # electron-builder, for the platform you are on
```

Releases are built by GitHub Actions on all three platforms — the native pieces
(better-sqlite3, sharp, ffmpeg) cannot be cross-built from one machine with any
confidence. Pushing a `v*` tag builds and attaches the results to a draft release.

| Path | What's in it |
| --- | --- |
| `src/main` | Main process: database, scanning, ffmpeg, the `media://` protocol |
| `src/main/cowatch` | Session server, room state, sync engine, guest client |
| `src/main/toy` | Intiface engine, toy connection, script loading, the mixing loop |
| `src/preload` | The IPC bridge — a fixed set of named calls, never a generic passthrough |
| `src/renderer` | React interface |
| `src/shared` | The IPC contract, shared by all three |
| `tests` | Vitest |

## Licence

Apache 2.0 — see [LICENSE](LICENSE). Use it, change it, ship it, sell it. Keep the
licence and the [NOTICE](NOTICE) with it, and say which files you changed.

If you build something on this, a credit is appreciated beyond what the licence asks
for — but it is a request, not a condition.
