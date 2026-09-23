/**
 * Which of the three platforms this process is on.
 *
 * Node reports more than three, and the differences that matter here - the
 * window chrome, the name of the file manager and of the Recycle Bin, how a
 * package is installed - fall into three groups, with every other Unix
 * behaving like Linux. The words themselves are in shared/platform.ts, which
 * the renderer uses too.
 */

import type { Platform } from '@shared/types'

export const PLATFORM: Platform =
  process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
