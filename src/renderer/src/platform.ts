/**
 * Which machine the window is on, read once.
 *
 * Three things differ between platforms once the app is built for all of them:
 * the strip of window the macOS traffic lights sit in, the name of the file
 * manager and the Trash, and the name of the modifier key. The platform comes
 * across the bridge as a plain value rather than being asked for at the moment
 * it is needed, and the words themselves live in shared/platform.ts.
 */

import {
  cloudflaredInstall,
  revealLabel,
  revealShort,
  trashName,
  withTrashName as nameTheTrash,
} from '@shared/platform'
import type { Platform } from '@shared/types'

export const PLATFORM: Platform = window.goonlib?.app?.platform ?? 'darwin'

export const IS_MAC = PLATFORM === 'darwin'
export const IS_WINDOWS = PLATFORM === 'win32'

export const REVEAL_LABEL = revealLabel(PLATFORM)
export const REVEAL_SHORT = revealShort(PLATFORM)
export const TRASH_NAME = trashName(PLATFORM)
export const CLOUDFLARED_INSTALL = cloudflaredInstall(PLATFORM)

/** Text written with the Trash in it, named the way this platform names it. */
export function withTrashName(text: string): string {
  return nameTheTrash(text, PLATFORM)
}

/**
 * Measures a scrollbar once and publishes it as `--scrollbar`.
 *
 * The library reserves a scrollbar gutter on both edges and works its columns
 * out from what is left; the Continue watching row above it has no scrollbar.
 * Unless the row subtracts the same amount, the two land on different column
 * counts at certain window widths and stop lining up. The width differs by
 * platform and by the `thin` keyword, so it is measured rather than assumed.
 */
export function measureScrollbar(): void {
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll;scrollbar-width:thin'
  document.body.append(probe)
  const width = probe.offsetWidth - probe.clientWidth
  probe.remove()
  document.documentElement.style.setProperty('--scrollbar', `${width}px`)
}

/**
 * Marks the document with the platform so the stylesheet can lay the chrome out
 * for it. Called before the first render: the top of the window is 22px taller
 * on macOS, and moving it after paint would be visible.
 */
export function markPlatform(): void {
  document.documentElement.dataset['platform'] = PLATFORM
}
