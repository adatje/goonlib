# GoonLib

A desktop media library for images and video. Electron + React + SQLite, local-first:
your files stay where they are, nothing is uploaded, and the only network calls are the
ones you ask for.

## What it does

- **Indexes folders you add** — probes with ffprobe, generates thumbnails and hover-scrub
  sprite sheets, and resumes where it left off if interrupted.
- **Plays almost anything** — Chromium decodes what it can; MKV and other awkward
  containers are remuxed, and codecs it cannot decode (HEVC, VC-1, ProRes) are transcoded
  lazily and cached.
- **Finds duplicates** — exact matches by content hash, near matches by perceptual hash.
- **Tags and collections** — by hand, or with a vision model (Claude, or anything serving
  an OpenAI-compatible endpoint, including a local LM Studio or Ollama).
- **Co-watching** — see below.
- **Toys** — Lovense and most other brands, following the video. See below.

## Co-watching

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
brew install cloudflared
```

`cloudflared` quick tunnels need no account. `ngrok` works too. Neither is bundled —
GoonLib runs whichever it finds and stops it when the session ends.

## Toys

Connect a toy from the wave button at the top of the sidebar. It works over Bluetooth
or the Lovense USB dongle, through the [Intiface](https://intiface.com) engine. The engine is downloaded the first time you connect (about 6 MB,
from the Buttplug.io GitHub release) and checked against a pinned SHA-256. If Intiface
Central is already running, GoonLib uses that instead.

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
Bluetooth). When running `npm run dev` from a terminal, it is the terminal app that
needs it.

## Running it

```bash
npm install
npm run dev
```

```bash
npm test
npm run typecheck
npm run dist
```

## Layout

| Path | What's in it |
| --- | --- |
| `src/main` | Main process: database, scanning, ffmpeg, the `media://` protocol |
| `src/main/cowatch` | Session server, room state, sync engine, guest client |
| `src/main/toy` | Intiface engine, toy connection, script loading, the mixing loop |
| `src/preload` | The IPC bridge — a fixed set of named calls, never a generic passthrough |
| `src/renderer` | React interface |
| `src/shared` | The IPC contract, shared by all three |
| `tests` | Vitest, no app window required |
