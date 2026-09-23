/**
 * What the app calls things on each platform.
 *
 * Three platforms means three names for the same thing in a handful of places -
 * the file manager, the Trash, the way a tunnel is installed - and the wording
 * has to match whichever machine the window is on. Keeping the words here, as
 * functions of a platform rather than of the machine this process happens to be
 * running on, means both sides can use them and both can be tested.
 */

import type { Platform } from './types'

/** What "show me this file" is called. */
export function revealLabel(platform: Platform): string {
  if (platform === 'darwin') return 'Reveal in Finder'
  if (platform === 'win32') return 'Show in Explorer'
  return 'Show in file manager'
}

/** The short version, for a button with no room for the rest. */
export function revealShort(platform: Platform): string {
  return platform === 'darwin' ? 'Reveal' : 'Show'
}

/** Where a deleted file goes, by name. */
export function trashName(platform: Platform): string {
  return platform === 'win32' ? 'Recycle Bin' : 'Trash'
}

/**
 * Display text written with the macOS name in it, with the Trash called what it
 * is called here. Cheaper than keeping two copies of every string that mentions
 * it, and the word only appears in the one sense anywhere in the app.
 */
export function withTrashName(text: string, platform: Platform): string {
  const name = trashName(platform)
  return name === 'Trash' ? text : text.replaceAll('Trash', name)
}

/**
 * How cloudflared is installed here, or null where there is no single command
 * to give. It is the tunnel Watch Together reaches for first; on Linux it is a
 * different command on every distribution, so there it is named rather than
 * typed out.
 */
export function cloudflaredInstall(platform: Platform): string | null {
  if (platform === 'darwin') return 'brew install cloudflared'
  if (platform === 'win32') return 'winget install --id Cloudflare.cloudflared'
  return null
}

/** How ffmpeg is usually installed here, for the message that asks for it. */
export function ffmpegInstallHint(platform: Platform): string {
  if (platform === 'darwin') return 'e.g. `brew install ffmpeg`'
  if (platform === 'win32') return 'e.g. `winget install ffmpeg`'
  return 'e.g. `apt install ffmpeg`'
}
