/**
 * The right-click menu for media items.
 *
 * Built as a native Electron menu rather than an HTML one: on macOS an in-page
 * menu is immediately recognisable as fake — wrong font, wrong shadow, no
 * keyboard traversal, no submenu timing — and this is exactly the interaction
 * where people expect the system's own behaviour.
 *
 * The actions live here rather than in the renderer because every one of them
 * touches something the renderer has no business reaching: the clipboard, the
 * Finder, the Trash.
 */

import { BrowserWindow, clipboard, Menu, nativeImage, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { IPC } from '@shared/types'
import type { ContextMenuRequest } from '@shared/types'
import {
  addToCollection,
  getCollection,
  listCollections,
  removeFromCollection,
} from './db/collections'
import { setFavorite } from './db/favorites'
import { getMedia } from './db/media'
import { getMediaLocation } from './db/queries'
import { listTags, tagIdsFor, tagMedia, untagMedia } from './db/tags'
import { resolveWithinRoot } from './protocol/confine'
import { trashHistory } from './trash'

/** Tells the renderer something changed, or asks it to prompt for a name. */
function notify(window: BrowserWindow | null, action: string, payload: unknown): void {
  if (window && !window.isDestroyed()) window.webContents.send(IPC.contextMenuAction, { action, payload })
}

export async function showMediaContextMenu(
  window: BrowserWindow | null,
  request: ContextMenuRequest,
): Promise<void> {
  const item = getMedia(request.mediaId)
  if (!item) return

  const location = getMediaLocation(request.mediaId)
  const absPath = location
    ? await resolveWithinRoot(location.rootPath, location.relPath)
    : null

  const collections = listCollections()
  const activeCollection =
    request.collectionId !== undefined && request.collectionId !== null
      ? getCollection(request.collectionId)
      : null

  const template: MenuItemConstructorOptions[] = [
    {
      label: item.kind === 'video' ? 'Play' : 'Open',
      click: () => notify(window, 'open', { mediaId: item.id }),
    },
    {
      label: 'Favorite',
      // A checkbox, like Tags: the tick is the current state and clicking flips it.
      type: 'checkbox',
      checked: item.favoritedAt !== null,
      click: () => {
        setFavorite([item.id], item.favoritedAt === null)
        notify(window, 'changed', { mediaId: item.id })
      },
    },
    { type: 'separator' },
    {
      label: 'Collections',
      submenu: [
        ...collections.map<MenuItemConstructorOptions>((collection) => ({
          label: collection.name,
          // Already a member: show it ticked and do nothing rather than hiding it,
          // so the menu reads as a consistent list of where this item lives.
          enabled: collection.id !== activeCollection?.id,
          click: () => {
            addToCollection(collection.id, [item.id])
            notify(window, 'changed', { mediaId: item.id })
          },
        })),
        ...(collections.length > 0 ? [{ type: 'separator' } as MenuItemConstructorOptions] : []),
        {
          label: 'New Collection…',
          // Native menus can't take text input, so the renderer prompts.
          click: () => notify(window, 'new-collection', { mediaId: item.id }),
        },
      ],
    },
    ...(activeCollection
      ? [
          {
            label: `Remove from “${activeCollection.name}”`,
            click: () => {
              removeFromCollection(activeCollection.id, [item.id])
              notify(window, 'changed', { mediaId: item.id })
            },
          } as MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'Tags',
      submenu: tagSubmenu(window, item.id),
    },
    { type: 'separator' },
    {
      label: 'Copy',
      enabled: absPath !== null,
      // Copies the file itself, so it can be pasted into Finder, Mail, Messages.
      click: () => absPath && copyFiles([absPath]),
    },
    ...(item.kind === 'image'
      ? [
          {
            label: 'Copy Image',
            enabled: absPath !== null,
            click: () => absPath && copyImage(absPath),
          } as MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'Copy File Path',
      enabled: absPath !== null,
      click: () => absPath && clipboard.writeText(absPath),
    },
    {
      label: 'Copy Filename',
      click: () => clipboard.writeText(item.name),
    },
    { type: 'separator' },
    {
      label: 'Reveal in Finder',
      enabled: absPath !== null,
      click: () => absPath && shell.showItemInFolder(absPath),
    },
    { type: 'separator' },
    {
      // No ellipsis: it no longer opens anything, it just does it.
      label: 'Move to Trash',
      enabled: absPath !== null,
      click: () => {
        if (absPath) void moveToTrash(window, item.id, absPath)
      },
    },
  ]

  Menu.buildFromTemplate(template).popup(window ? { window } : undefined)
}

/**
 * The Tags submenu: every tag as a checkbox, ticked when this item carries it.
 *
 * One list that both adds and removes, rather than an "Add tag" menu and a
 * separate "Remove tag" one — a checkbox already means "this is on, click to
 * turn it off" everywhere else on the system, and it keeps the item's whole tag
 * state visible at a glance.
 *
 * Tags already on the item sort to the top. Removing one is the reason you open
 * this menu, and a library that has been classified can have a long tail of
 * AI-suggested tags that would otherwise bury them.
 */
function tagSubmenu(window: BrowserWindow | null, mediaId: number): MenuItemConstructorOptions[] {
  const attached = new Set(tagIdsFor(mediaId))
  const tags = listTags()

  const ordered = [
    ...tags.filter((tag) => attached.has(tag.id)),
    ...tags.filter((tag) => !attached.has(tag.id)),
  ]

  const entries = ordered.map<MenuItemConstructorOptions>((tag) => ({
    label: tag.name,
    type: 'checkbox',
    checked: attached.has(tag.id),
    click: () => {
      if (attached.has(tag.id)) untagMedia(tag.id, [mediaId])
      else tagMedia(tag.id, [mediaId])
      notify(window, 'changed', { mediaId })
    },
  }))

  return [
    ...entries,
    ...(entries.length > 0 ? [{ type: 'separator' } as MenuItemConstructorOptions] : []),
    {
      label: 'New Tag…',
      // Native menus can't take text input, so the renderer prompts.
      click: () => notify(window, 'new-tag', { mediaId }),
    },
  ]
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
async function moveToTrash(
  window: BrowserWindow | null,
  mediaId: number,
  absPath: string,
): Promise<void> {
  try {
    // Through the history, so Cmd/Ctrl+Z can put it back.
    trashHistory.record([await trashHistory.trash(mediaId, absPath)])
    notify(window, 'changed', { mediaId })
  } catch (err) {
    console.error(`[trash] failed for ${absPath}:`, err)
  }
}
