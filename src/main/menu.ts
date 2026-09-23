/**
 * The parts of the right-click menu that only the main process can do: the
 * clipboard, the Finder, the Trash.
 *
 * The menu itself is drawn by the renderer now, in the app's own colours, with
 * the same collection and tag menus the viewer has — a native menu could not
 * take a new collection's name, and could not look like the rest of the app on
 * three platforms. What is left here is everything that touches the machine.
 */

import { BrowserWindow, clipboard, nativeImage, shell } from 'electron'
import type { MediaFileAction } from '@shared/types'
import { getMedia } from './db/media'
import { getMediaLocation } from './db/queries'
import { resolveWithinRoot } from './protocol/confine'
import { trashHistory } from './trash'

/**
 * Carries out one of those actions on one item. Resolves false when there was
 * nothing to act on — a file that has gone missing, say.
 */
export async function runFileAction(
  window: BrowserWindow | null,
  action: MediaFileAction,
  mediaId: number,
): Promise<boolean> {
  const item = getMedia(mediaId)
  if (!item) return false

  if (action === 'copy-name') {
    clipboard.writeText(item.name)
    return true
  }

  const location = getMediaLocation(mediaId)
  const path = location ? await resolveWithinRoot(location.rootPath, location.relPath) : null
  if (!path) return false

  switch (action) {
    case 'copy':
      copyFiles([path])
      return true
    case 'copy-image':
      copyImage(path)
      return true
    case 'copy-path':
      clipboard.writeText(path)
      return true
    case 'reveal':
      shell.showItemInFolder(path)
      return true
    case 'trash':
      return moveToTrash(mediaId, path)
  }
}

/**
 * Puts real files on the clipboard.
 *
 * macOS expects a property list under NSFilenamesPboardType; writing the path as
 * plain text would paste the string rather than the file. Other platforms have no
 * equivalent through Electron's API, so they get the path as text — which is at
 * least useful rather than silently doing nothing.
 */
function copyFiles(paths: string[]): void {
  if (process.platform !== 'darwin') {
    clipboard.writeText(paths.join('\n'))
    return
  }

  const entries = paths.map((path) => `<string>${escapeXml(path)}</string>`).join('')
  const plist =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ' +
    '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">' +
    `<plist version="1.0"><array>${entries}</array></plist>`

  clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plist, 'utf8'))
}

function copyImage(absPath: string): void {
  const image = nativeImage.createFromPath(absPath)
  // Formats Chromium can't decode come back empty; fall back to the file itself
  // rather than silently clearing the clipboard.
  if (image.isEmpty()) copyFiles([absPath])
  else clipboard.writeImage(image)
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Moves one file to the Trash, with nothing in between.
 *
 * Deliberately unconfirmed: this is reached by picking a named item out of a
 * context menu, which is a specific enough act on its own, and the file goes to
 * the system Trash rather than being unlinked. The bulk path in ipc.ts still
 * asks, because there the count is the thing worth checking.
 */
async function moveToTrash(mediaId: number, absPath: string): Promise<boolean> {
  try {
    // Through the history, so Cmd/Ctrl+Z can put it back.
    trashHistory.record([await trashHistory.trash(mediaId, absPath)])
    return true
  } catch (err) {
    console.error(`[trash] failed for ${absPath}:`, err)
    return false
  }
}
