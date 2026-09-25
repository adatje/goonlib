# Updating itself

Essential before beta: a build in someone's Applications folder has no way to
learn that a newer one exists. Written 2026-09-25, against 0.9.11.

## Where we already stand

- The repository is **public**, so `electron-updater` can read releases over plain
  HTTPS with no token compiled into the app. This is the thing that usually kills
  the idea, and it is already solved.
- `electron-builder` is the packager, so `electron-updater` is its companion and
  needs no separate release pipeline: the same build writes the `latest*.yml`
  manifests the updater reads.
- CI already builds all three platforms on a `v*` tag.

## What stands in the way

**Releases are drafts.** `.github/workflows/release.yml` creates a draft and
attaches the artifacts; the updater only ever sees published, non-prerelease
releases, so `/releases/latest` is a 404 today. Either the workflow publishes
directly, or each draft is published by hand once its notes are written. The
second is the safer habit: an accidental tag then cannot ship itself to everyone.

**macOS cannot install an unsigned update.** Squirrel.Mac refuses to apply one to
an app with no valid code signature, and nothing is signed
(`docs/cross-platform-plan.md`, stage 4). Windows NSIS and Linux AppImage update
unsigned without complaint. So macOS degrades: it still *checks*, and tells the
user a new version is out with a link to the release, but it cannot replace itself
until there is a Developer ID. This is the strongest practical argument for buying
one - it is not about the Gatekeeper warning, it is about never updating.

## The build

1. `npm i electron-updater` (a dependency, not a dev one - it ships).
2. `electron-builder.yml`:
   ```yaml
   publish:
     provider: github
     owner: adatje
     repo: goonlib
   ```
   That alone makes each build write `latest.yml`, `latest-mac.yml` and
   `latest-linux.yml` beside the installers. They must be attached to the release:
   the workflow's `find` currently uploads only `*.dmg`, `*.exe` and `*.AppImage`,
   so it needs `*.yml` and `*.blockmap` too, or the updater has nothing to read.
3. `src/main/updates.ts`, owning the whole conversation with `autoUpdater`:
   - `autoUpdater.autoDownload = false` - ask before spending someone's bandwidth.
   - Check once a few seconds after launch (never blocking first paint) and on
     demand; a setting decides whether the automatic one happens at all.
   - On macOS, or any unsigned build, skip `downloadUpdate()` entirely and report
     `available-manual` with the release URL.
   - States worth reporting to the renderer, and nothing more: `idle`, `checking`,
     `none`, `available`, `downloading` (with percent), `ready`, `manual`, `error`.
4. IPC, the same shape as the rest: `updates:status`, `updates:check`,
   `updates:download`, `updates:install`, and an `updates:update` broadcast.
5. Renderer: a row in Settings → App showing the running version and the state,
   with one button that means the right thing at each step (Check / Download /
   Restart / Open the release). A quiet banner when an update is ready is worth
   having later; the settings row is enough to ship.
6. A setting, `updates.automatic`, default on, beside it.

## Testing it

The awkward part: an updater cannot be tested from a development build, because
`autoUpdater` refuses to run unpackaged. The usual way round it is a
`dev-app-update.yml` beside the binary pointing at the real repo, and a build
whose version is deliberately *older* than the published release - then watch it
find and fetch the newer one. Worth doing once on Windows or Linux, where the
install step actually completes.

## Order

1. Publish config and the manifests into the release, so there is something to
   read.
2. `updates.ts` and the IPC, with the manual path only - it is the honest
   behaviour on this machine anyway.
3. The Settings row and the setting.
4. Download-and-install, tested on Linux or Windows.
5. macOS self-install, the day there is a Developer ID.
