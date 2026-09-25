# Contributing

Setup and contribution instructions for the repository. If you only want to *use*
GoonLib, the [README](README.md) has the downloads — nothing here is needed.


## For developers

Electron + React + SQLite. Requires Node 22.

```bash
npm install
npm run dev
```

`npm install` runs `electron-builder install-app-deps` afterwards, which rebuilds
the native modules (better-sqlite3, sharp) against Electron's own Node. If you
ever see `NODE_MODULE_VERSION` complaints, run `npm run postinstall` again — that
is almost always what it means.

Running from a terminal, it is the terminal app that macOS asks to allow Bluetooth
for, not GoonLib.

```bash
npm test          # vitest, no app window required
npm run typecheck # two tsc projects, main/preload/shared and renderer
npm run dist      # electron-builder, for the platform you are on
```

Both `npm test` and `npm run typecheck` are quick and neither needs a window, so
there is no reason not to run them before pushing. `npm run build` runs typecheck
first and fails on it.

Releases are built by GitHub Actions on all three platforms — the native pieces
(better-sqlite3, sharp, ffmpeg) cannot be cross-built from one machine with any
confidence. Pushing a `v*` tag builds and attaches the results to a draft release,
which is published by hand.


### Where things live

| Path | What's in it |
| --- | --- |
| `src/main` | Main process: database, scanning, ffmpeg, the `media://` protocol |
| `src/main/cowatch` | Session server, room state, sync engine, guest client |
| `src/main/toy` | Intiface engine, toy connection, script loading, the mixing loop |
| `src/preload` | The IPC bridge — a fixed set of named calls, never a generic passthrough |
| `src/renderer` | React interface |
| `src/shared` | The IPC contract, shared by all three |
| `tests` | Vitest |

Your own library and settings are not in the repository. They live in Electron's
`userData` directory — `goonlib.db` for the database and `derived/` for thumbnails
and sprite sheets:

- macOS: `~/Library/Application Support/goonlib`
- Windows: `%APPDATA%\goonlib`
- Linux: `~/.config/goonlib`

A development build uses the same directory as an installed one, so **you are
working against your real library**. Copy `goonlib.db` somewhere safe before
touching migrations.


### Restarting dev

`npm run dev` hot-reloads the renderer only. Anything in `src/main`, `src/preload`
or `src/shared` needs the whole thing restarted — a preload that has changed under
a running window gives you missing-function errors rather than a clear failure.

Stop it properly: killing the vite process on its own leaves the Electron window
behind, and the next `npm run dev` then gives you two.


## Working in the codebase

### Adding an IPC call

The bridge is a fixed list on purpose, so one new call touches four places, in
this order:

1. `src/shared/types.ts` — a constant in `IPC`, and the method on the `GoonLibApi`
   interface with its doc comment.
2. `src/preload/index.ts` — the `ipcRenderer.invoke` wrapper.
3. `src/main/ipc.ts` — the handler, coercing its arguments (`Number(...)`,
   `String(...)`) rather than trusting them.
4. The main-process function that does the work.

The renderer never gets a generic "run this" channel, and adding one would defeat
the point of the bridge.

### Database changes

Schema changes are migrations in `src/main/db/migrations.ts`, applied in order and
tracked with SQLite's `user_version`. Add a new entry with the next version number;
never edit an existing one, because somebody's database has already run it.

### Platform wording

Anything the user reads that differs by platform — the Trash, the file manager, how
a tunnel is installed — comes from `src/shared/platform.ts` as a function of a
platform rather than of the machine this process happens to be on. That way both
sides can use it and both can be tested.

### Tests

Vitest, in `tests/`. There is no DOM-rendering suite: what is tested is the logic
that can be pulled out of the components, which is why files like
`src/renderer/src/selection.ts` exist apart from the screens that use them. If you
are writing something where being wrong costs somebody a file, put the rule in a
plain function and test it directly.


## Style

Match what is already there rather than any general convention.

- **Comments say why, not what.** The code says what it does. A comment earns its
  place by explaining a decision, a constraint or a trap — something a reader would
  otherwise have to rediscover.
- **Prose, not shorthand.** Comments are sentences, and the doc comment on a module
  or an exported function explains what it is for and what it refuses to do.
- **Commit messages are sentences too.** `Scanning and classifying are separate
  jobs, and a scan says when it is done`, not `feat(scan): split`. The body
  explains the reasoning; `git log` is where most of this project's design
  decisions are actually written down.

There is no linter or formatter configured. Two-space indent, single quotes, no
semicolons — copy the file you are in.


## Contributing

The project is Apache 2.0 and contributions are welcome, including forks that go
their own way.

- Branch off `main` and open a pull request against it.
- Run `npm test` and `npm run typecheck` first.
- Keep a change to one thing. A pull request that fixes a bug and also reorganises
  three files is two pull requests.
- If you are changing behaviour rather than fixing it, say what you considered and
  rejected. That reasoning is the part worth reviewing.

Bug reports are most useful with your platform, the app version (Settings shows it
at the foot of the sheet), and what you expected instead.

One thing to be aware of if you are opening an issue: this is an adult media
application, and screenshots of it generally are too. Crop or blur before posting.
