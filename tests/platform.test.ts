/**
 * What the app calls things on each platform.
 *
 * The renderer binds these to the platform the bridge reports and the main
 * process to its own; what is worth testing is the words themselves.
 */

import { describe, expect, it } from 'vitest'
import {
  cloudflaredInstall,
  ffmpegInstallHint,
  revealLabel,
  revealShort,
  trashName,
  withTrashName,
} from '../src/shared/platform'

describe('naming things the way the platform does', () => {
  it('names the file manager', () => {
    expect(revealLabel('darwin')).toBe('Reveal in Finder')
    expect(revealLabel('win32')).toBe('Show in Explorer')
    expect(revealLabel('linux')).toBe('Show in file manager')
  })

  it('shortens it for a button with no room', () => {
    expect(revealShort('darwin')).toBe('Reveal')
    expect(revealShort('win32')).toBe('Show')
    expect(revealShort('linux')).toBe('Show')
  })

  it('calls the Trash the Recycle Bin on Windows only', () => {
    expect(trashName('darwin')).toBe('Trash')
    expect(trashName('linux')).toBe('Trash')
    expect(trashName('win32')).toBe('Recycle Bin')
  })

  it('renames the Trash inside text written for a Mac', () => {
    expect(withTrashName('Move selection to Trash', 'win32')).toBe('Move selection to Recycle Bin')
    expect(withTrashName('Move to Trash', 'win32')).toBe('Move to Recycle Bin')
  })

  it('leaves that text alone where the name is already right', () => {
    expect(withTrashName('Move selection to Trash', 'darwin')).toBe('Move selection to Trash')
    expect(withTrashName('Move selection to Trash', 'linux')).toBe('Move selection to Trash')
  })

  it('gives the cloudflared command only where there is one', () => {
    expect(cloudflaredInstall('darwin')).toBe('brew install cloudflared')
    expect(cloudflaredInstall('win32')).toContain('winget')
    // Every distribution installs it differently, so Linux is told to find it
    // rather than given a command that is wrong on most of them.
    expect(cloudflaredInstall('linux')).toBeNull()
  })

  it('names the package manager that has ffmpeg', () => {
    expect(ffmpegInstallHint('darwin')).toContain('brew')
    expect(ffmpegInstallHint('win32')).toContain('winget')
    expect(ffmpegInstallHint('linux')).toContain('apt')
  })
})
