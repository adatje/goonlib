/**
 * The pages served to a browser guest.
 *
 * Kept as real .html files and inlined at build time rather than as template
 * literals in TypeScript: the client is a few hundred lines of markup, CSS and
 * script, and burying that in an escaped string makes it unreadable and
 * un-lintable for no gain.
 */

import appHtml from './client/app.html?raw'
import joinHtml from './client/join.html?raw'
import { themes } from '../theme'

/** The knock-and-wait page. Reads its invite from its own URL. */
export function joinPage(): string {
  return joinHtml
}

/**
 * The session proper. Only ever served to a request carrying a valid cookie.
 * Carries the host's theme, read fresh each time, so a reload picks up a change.
 */
export function appPage(): string {
  return appHtml.replace('</head>', `<style id="theme">\n${themes.guestCss()}\n</style>\n</head>`)
}
