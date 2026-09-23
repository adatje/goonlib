import { useState } from 'react'

/**
 * Settings and themes, out to a file and back in.
 *
 * Only settings and themes: what is filed under which tag is about this
 * machine's own files, and carrying that to another machine would mean
 * guessing which copy is which. Preferences are yours, not your files'.
 */
export function BackupSettings(): React.JSX.Element {
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  const run = (
    work: () => Promise<boolean>,
    done: string,
  ): void => {
    setNote(null)
    void work()
      .then((ok) => ok && setNote({ ok: true, text: done }))
      .catch((err: unknown) =>
        setNote({ ok: false, text: err instanceof Error ? err.message : String(err) }),
      )
  }

  return (
    <div className="toy__section">
      <div className="settings__row settings__row--tight">
        <button
          type="button"
          className="button"
          onClick={() => run(() => window.goonlib.settings.export(), 'Settings written to the file.')}
          title="Write your settings and themes to a file"
        >
          Export settings…
        </button>
        <button
          type="button"
          className="button button--quiet"
          onClick={() => run(() => window.goonlib.settings.import(), 'Settings restored from the file.')}
          title="Put settings and themes back from a file"
        >
          Import settings…
        </button>
      </div>

      {note ? <span className={note.ok ? 'settings__ok' : 'settings__bad'}>{note.text}</span> : null}

      <span className="settings__hint">
        Preferences, toy settings and your themes, in one file. Your library and its tags,
        collections and favourites are not part of it, and neither is your AI key.
      </span>
    </div>
  )
}
