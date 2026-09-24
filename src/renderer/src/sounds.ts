/**
 * The sonar, and who is allowed to sound it.
 *
 * One ping when a scan is asked for, and the same ping over and over while the
 * classifier is working, which is the part of a scan long enough to wander off
 * from. One element either way: two sonars at once is a submarine film, not a
 * media library.
 */

import scanSound from './assets/scan.mp3'

/**
 * Quieter than the other sounds, because this one repeats: a ping every few
 * seconds at the volume of a one-off chime wears out its welcome by the third.
 */
const VOLUME = 0.4

/**
 * How long the loop may sound for, however long the classifier takes.
 *
 * Classifying a large library is a job measured in hours, and a sonar that
 * kept pace with it would be a punishment rather than a signal. Half a minute
 * is enough to say "this has started and is still going"; after that the work
 * carries on in silence, with the bar still saying so.
 */
const MAX_MS = 30_000

let audio: HTMLAudioElement | null = null
/** What the app last said the classifier was doing. */
let classifying = false
/** Whether the loop is actually audible, which the cap can end early. */
let sounding = false
let capTimer: ReturnType<typeof setTimeout> | null = null

function sound(loop: boolean): void {
  audio?.pause()
  audio = new Audio(scanSound)
  audio.loop = loop
  audio.volume = VOLUME
  // Refused autoplay is not worth an error: the app is no worse for being quiet.
  void audio.play().catch(() => undefined)
}

function hush(): void {
  audio?.pause()
  audio = null
}

/** One ping, as Rescan starts looking. A second click restarts it rather than doubling it. */
export function playScanPing(): void {
  // Already sounding for the classifier; a click should not cut it short. Once
  // the cap has quietened that, a ping is welcome again.
  if (sounding) return
  sound(false)
}

/**
 * Pings while classification runs, for up to MAX_MS, and stops the moment it
 * ends - whether it finished, was stopped, or failed. A later run starts the
 * half minute again.
 */
export function setClassifyingSound(on: boolean): void {
  if (on === classifying) return
  classifying = on

  if (!on) {
    stopLoop()
    return
  }

  sounding = true
  sound(true)
  capTimer = setTimeout(stopLoop, MAX_MS)
}

function stopLoop(): void {
  if (capTimer !== null) {
    clearTimeout(capTimer)
    capTimer = null
  }
  if (!sounding) return
  sounding = false
  hush()
}
