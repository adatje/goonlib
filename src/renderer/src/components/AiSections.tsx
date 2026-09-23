import { useCallback, useEffect, useState } from 'react'
import { ADULT_CATEGORIES } from '@shared/categories'
import { AI_MODELS, AI_PROVIDERS, DEFAULT_BASE_URL } from '@shared/types'
import type {
  AiProvider,
  AiSettings,
  AiSettingsView,
  AiTestResult,
} from '@shared/types'
import { CheckIcon, SearchIcon, WarningIcon } from './SidebarIcons'
import { formatCount } from '../format'
import { TabPanel } from './TabPanel'
import type { SheetTab } from './TabPanel'

export interface AiSectionsProps {
  /** Which tab of the Settings sheet is showing. */
  tab: SheetTab
  onSelectTab: (tab: SheetTab) => void
  /** Fired after anything that could change the library, so the grid refreshes. */
  onChanged: () => void
  /** Closes the sheet and shows the duplicates screen. */
  onOpenDuplicates: () => void
}

/**
 * How alike two pictures must look to be grouped as duplicates, as the
 * Hamming distance between their perceptual hashes. Loose stops at 7, the
 * furthest the hash banding is guaranteed to find.
 */
const SIMILARITY: Array<{ distance: number; label: string; note: string; icon: React.ReactNode }> = [
  { distance: 3, label: 'Strict', note: 'Identical matches only', icon: <CheckIcon /> },
  {
    distance: 6,
    label: 'Balanced',
    note: 'Includes lightly cropped, filters and watermarks.',
    icon: <SearchIcon />,
  },
  { distance: 7, label: 'Loose', note: 'Loose matches only', icon: <WarningIcon /> },
]

/**
 * The AI tabs of the Settings sheet: who does the labelling, what it labels
 * with, how duplicates are judged, and running a classification pass by hand.
 * All four are rendered at once and only one shown, so what is typed into one
 * survives a look at another.
 *
 * Every control writes through to the main process as it changes rather than
 * batching behind a Save button — there is no partially-applied state to get
 * wrong, and the scan reads these values on its next pass either way.
 */
export function AiSections(props: AiSectionsProps): React.JSX.Element {
  const [settings, setSettings] = useState<AiSettingsView | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [keyDraft, setKeyDraft] = useState('')
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<AiTestResult | null>(null)
  const [queued, setQueued] = useState<number | null>(null)
  const [available, setAvailable] = useState<string[] | null>(null)
  const [loadingModels, setLoadingModels] = useState(false)

  const [distance, setDistance] = useState<number | null>(null)
  // How many the duplicates page would show, counted the same way, whenever
  // this tab is opened or the threshold moves.
  const [dupeCount, setDupeCount] = useState<number | null>(null)
  const onDuplicatesTab = props.tab === 'duplicates'

  useEffect(() => {
    if (!onDuplicatesTab || distance === null) return
    let current = true
    void window.goonlib.duplicates
      .find()
      .then((report) => {
        if (current) setDupeCount(report.exact.length + report.near.length)
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [onDuplicatesTab, distance])

  useEffect(() => {
    void window.goonlib.duplicates.distance().then(setDistance).catch(() => undefined)

    void window.goonlib.ai
      .settings()
      .then(setSettings)
      .catch((err: unknown) => setError(message(err)))
  }, [])

  const guard = useCallback(async (action: () => Promise<AiSettingsView>) => {
    try {
      setSettings(await action())
      setError(null)
    } catch (err) {
      setError(message(err))
    }
  }, [])

  const patch = useCallback(
    (changes: Partial<AiSettings>) => void guard(() => window.goonlib.ai.update(changes)),
    [guard],
  )

  const saveKey = useCallback(() => {
    const key = keyDraft.trim()
    if (!key) return
    setTest(null)
    void guard(async () => {
      const next = await window.goonlib.ai.setKey(key)
      setKeyDraft('')
      return next
    })
  }, [keyDraft, guard])

  const runTest = useCallback(async () => {
    setTesting(true)
    setTest(null)
    try {
      setTest(await window.goonlib.ai.test())
    } catch (err) {
      setTest({ ok: false, message: message(err) })
    }
    setTesting(false)
  }, [])

  const loadModels = useCallback(async () => {
    setLoadingModels(true)
    try {
      setAvailable(await window.goonlib.ai.models())
      setError(null)
    } catch (err) {
      // Left null, not empty: an empty list renders as "None loaded" and takes
      // the Load button away, so a failed fetch would strand the user with no
      // way to retry short of reopening settings.
      setAvailable(null)
      setError(message(err))
    }
    setLoadingModels(false)
  }, [])

  const changeDistance = useCallback((next: number) => {
    void window.goonlib.duplicates
      .setDistance(next)
      .then(setDistance)
      .catch((err: unknown) => setError(message(err)))
  }, [])

  const reclassify = useCallback(
    async (all: boolean) => {
      setQueued(null)
      try {
        const count = await window.goonlib.ai.reclassify(all)
        setQueued(count)
        props.onChanged()
      } catch (err) {
        setError(message(err))
      }
    },
    [props],
  )

  const { tab } = props
  const choose = props.onSelectTab

  if (settings === null) {
    return (
      <p className="muted" hidden={!AI_TABS.includes(tab)}>
        {error ?? 'Loading…'}
      </p>
    )
  }

  return (
    <>
      {error && AI_TABS.includes(tab) ? (
        <div className="banner banner--error settings__banner" role="alert">
          {error}
        </div>
      ) : null}

            <TabPanel id="providers" tab={tab}>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={(event) => patch({ enabled: event.target.checked })}
                />
                <span className="switch__text">
                  <span className="switch__label">Categorise with AI</span>
                  <span className="switch__hint">
                    {settings.provider === 'openai'
                      ? 'Sends each media item\'s thumbnail to a classifier model during scans and receives back tag(s) for labelling.'
                      : "Sends each item's thumbnail to Claude during a scan and records what comes back as labels. Off by default - it costs money per item."}
                  </span>
                </span>
              </label>

              {settings.enabled ? (
                <div className="settings__group">
                  <Field label="Provider" hint={providerNote(settings.provider)}>
                    <select
                      className="settings__select"
                      value={settings.provider}
                      onChange={(event) => {
                        setTest(null)
                        setAvailable(null)
                        patch({ provider: event.target.value as AiProvider })
                      }}
                    >
                      {AI_PROVIDERS.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.label}
                        </option>
                      ))}
                    </select>
                  </Field>

                  {settings.provider === 'openai' ? (
                    <Field
                      label="Server address"
                      hint="Include the /v1 path. LM Studio serves this once you start its local server."
                    >
                      <BaseUrlEditor
                        baseUrl={settings.baseUrl}
                        onCommit={(baseUrl) => {
                          setTest(null)
                          setAvailable(null)
                          patch({ baseUrl })
                        }}
                      />
                    </Field>
                  ) : null}

                  <Field
                    label={settings.provider === 'anthropic' ? 'API key' : 'API key (optional)'}
                    hint={keyStatus(settings)}
                  >
                    <div className="settings__row">
                      <input
                        type="password"
                        className="settings__input"
                        placeholder={settings.apiKeyPresent ? 'Replace the stored key…' : 'sk-ant-…'}
                        value={keyDraft}
                        onChange={(event) => setKeyDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') saveKey()
                        }}
                        autoComplete="off"
                        spellCheck={false}
                        aria-label="Claude API key"
                      />
                      <button
                        type="button"
                        className="button"
                        onClick={saveKey}
                        disabled={keyDraft.trim().length === 0}
                      >
                        Save
                      </button>
                      {settings.apiKeyPresent ? (
                        <button
                          type="button"
                          className="button button--quiet"
                          onClick={() => {
                            setTest(null)
                            void guard(() => window.goonlib.ai.clearKey())
                          }}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>

                    <div className="settings__row settings__row--tight">
                      <button
                        type="button"
                        className="button button--quiet"
                        onClick={() => void runTest()}
                        disabled={!settings.ready || testing}
                      >
                        {testing ? 'Testing…' : 'Test connection'}
                      </button>
                      {test ? (
                        <span className={test.ok ? 'settings__ok' : 'settings__bad'}>
                          {test.message}
                        </span>
                      ) : null}
                    </div>
                  </Field>

                  {settings.provider === 'anthropic' ? (
                    <Field label="Model" hint="Cheaper models label faster and cost less per item.">
                      <select
                        className="settings__select"
                        value={settings.model}
                        onChange={(event) => patch({ model: event.target.value })}
                      >
                        {AI_MODELS.some((model) => model.id === settings.model) ? null : (
                          <option value={settings.model}>{settings.model}</option>
                        )}
                        {AI_MODELS.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.label} - {model.note}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ) : (
                    <Field
                      label="Model"
                      hint="Requires a matching model_id for a vision-capable model"
                    >
                      {available === null ? (
                        <div className="settings__row">
                          <ModelEditor
                            model={settings.model}
                            onCommit={(model) => patch({ model })}
                          />
                          <button
                            type="button"
                            className="button button--quiet"
                            onClick={() => void loadModels()}
                            disabled={loadingModels}
                          >
                            {loadingModels ? 'Loading…' : 'Load'}
                          </button>
                        </div>
                      ) : available.length === 0 ? (
                        <div className="settings__row">
                          <ModelEditor
                            model={settings.model}
                            onCommit={(model) => patch({ model })}
                          />
                          <span className="settings__bad">None loaded</span>
                        </div>
                      ) : (
                        <select
                          className="settings__select"
                          value={settings.model}
                          onChange={(event) => patch({ model: event.target.value })}
                        >
                          {/* Keep the stored value selectable even when the server
                              has since unloaded it, so opening settings can't
                              silently rewrite the model out from under a scan. */}
                          {available.includes(settings.model) ? null : (
                            <option value={settings.model}>{settings.model} (not loaded)</option>
                          )}
                          {available.map((id) => (
                            <option key={id} value={id}>
                              {id}
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>
                  )}

                  <Field
                    label="Requests at once"
                    hint={
                      settings.provider === 'openai'
                        ? 'Most local servers process one request at a time, so going much above 1 mainly queues them up. Raise it only if yours batches.'
                        : 'Higher finishes a backlog sooner but is likelier to hit your rate limit.'
                    }
                  >
                    <input
                      type="number"
                      className="settings__number"
                      min={1}
                      max={16}
                      value={settings.concurrency}
                      onChange={(event) => patch({ concurrency: Number(event.target.value) })}
                    />
                  </Field>
                </div>
              ) : null}
            </TabPanel>

            <TabPanel id="tagging" tab={tab}>
              {settings.enabled ? null : <OffNote onOpen={() => choose('providers')} />}

              <Field
                label="Labels"
                hint="One per line. Leave this empty and the model invents its own labels."
              >
                <CategoryEditor
                  categories={settings.categories}
                  onCommit={(categories) => patch({ categories })}
                />
                <div className="settings__row settings__row--tight">
                  <button
                    type="button"
                    className="button button--quiet"
                    onClick={() =>
                      patch({ categories: [...settings.categories, ...ADULT_CATEGORIES] })
                    }
                    title={`Adds the top ${ADULT_CATEGORIES.length} adult categories to what is already here; nothing you typed is lost`}
                  >
                    Pre-fill
                  </button>
                  <span className="muted">{settings.categories.length} in use</span>
                </div>
              </Field>

              <div className="settings__group">
                <label className="switch switch--compact">
                  <input
                    type="checkbox"
                    checked={settings.autoSort}
                    onChange={(event) => patch({ autoSort: event.target.checked })}
                  />
                  <span className="switch__text">
                    <span className="switch__label">Sort into collections automatically</span>
                    <span className="switch__hint">
                      Adds each item to a collection named after its labels. Collections are just
                      views - nothing on disk is moved or renamed.
                    </span>
                  </span>
                </label>

                {settings.autoSort ? (
                  <Field
                    label={`Confidence threshold - ${Math.round(settings.minConfidence * 100)}%`}
                    hint="Labels below this are still recorded, but won't file anything."
                  >
                    <input
                      type="range"
                      className="settings__range"
                      min={0}
                      max={100}
                      step={5}
                      value={Math.round(settings.minConfidence * 100)}
                      onChange={(event) =>
                        patch({ minConfidence: Number(event.target.value) / 100 })
                      }
                    />
                  </Field>
                ) : null}

                <label className="switch switch--compact">
                  <input
                    type="checkbox"
                    checked={settings.captions}
                    onChange={(event) => patch({ captions: event.target.checked })}
                  />
                  <span className="switch__text">
                    <span className="switch__label">Write a description of each item</span>
                    <span className="switch__hint">
                      Asked for in the same request as the labels, so it costs tokens but not an
                      extra call. Descriptions are added to the search index - you can then find
                      things by what is in them, not just by filename.
                    </span>
                  </span>
                </label>

                <label className="switch switch--compact">
                  <input
                    type="checkbox"
                    checked={settings.includeVideos}
                    onChange={(event) => patch({ includeVideos: event.target.checked })}
                  />
                  <span className="switch__text">
                    <span className="switch__label">Include videos</span>
                    <span className="switch__hint">
                      Videos are judged from their poster frame alone, so the labels are weaker
                      than for images.
                    </span>
                  </span>
                </label>
              </div>

              <div className="settings__group settings__field">
                <span className="settings__label">Classification</span>
                <div className="settings__row settings__row--tight">
                  <button
                    type="button"
                    className="button"
                    onClick={() => void reclassify(false)}
                    disabled={!settings.ready}
                    title="Queue everything that has never been labelled"
                  >
                    Classify unlabelled
                  </button>
                  <button
                    type="button"
                    className="button button--quiet"
                    onClick={() => void reclassify(true)}
                    disabled={!settings.ready}
                    title="Re-run everything, including items that already have labels"
                  >
                    Re-classify all
                  </button>
                  {queued !== null ? (
                    <span className="muted">
                      {queued === 0 ? 'Nothing to queue' : `${queued} queued`}
                    </span>
                  ) : null}
                </div>
                <span className="settings__hint">
                  New items are classified as they are scanned. These are for everything already
                  in the library - after changing the categories, say, Re-classify all labels it
                  again against the new list.
                </span>
              </div>
            </TabPanel>

            <TabPanel id="duplicates" tab={tab}>
              <div className="settings__field">
                <button type="button" className="button" onClick={props.onOpenDuplicates}>
                  Open duplicates
                </button>
                <span className="settings__hint">
                  Detected duplicate files{dupeCount === null ? '' : ` (${formatCount(dupeCount)})`}
                </span>
              </div>

              <div className="settings__group">
                <Field label="Likeness threshold">
                  <div className="cowatch__providers" role="radiogroup" aria-label="Similarity">
                    {SIMILARITY.map((option) => (
                      <button
                        key={option.distance}
                        type="button"
                        role="radio"
                        aria-checked={distance === option.distance}
                        className={
                          distance === option.distance
                            ? 'cowatch__provider cowatch__provider--on'
                            : 'cowatch__provider'
                        }
                        onClick={() => changeDistance(option.distance)}
                        title={option.note}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {(() => {
                    const chosen = SIMILARITY.find((option) => option.distance === distance)
                    return (
                      <span className="settings__hint settings__hint--icon">
                        {chosen ? chosen.icon : null}
                        {chosen ? chosen.note : 'A custom setting.'}
                      </span>
                    )
                  })()}
                </Field>
              </div>
            </TabPanel>

    </>
  )
}

const AI_TABS: SheetTab[] = ['providers', 'tagging', 'duplicates']

/** Said at the top of a tab whose settings do nothing while AI is switched off. */
function OffNote({ onOpen }: { onOpen: () => void }): React.JSX.Element {
  return (
    <p className="settings__hint settings__note">
      AI is switched off, so none of this runs yet.{' '}
      <button type="button" className="linkish" onClick={onOpen}>
        Turn it on under Providers
      </button>
      .
    </p>
  )
}

function providerNote(provider: AiProvider): string {
  return AI_PROVIDERS.find((entry) => entry.id === provider)?.note ?? ''
}

function keyStatus(settings: AiSettingsView): string {
  if (!settings.apiKeyPresent) {
    return settings.provider === 'openai'
      ? 'Local servers ignore this. Set it only if your endpoint requires a bearer token.'
      : 'Stored on this machine only, never sent to the window.'
  }

  return settings.apiKeyEncrypted
    ? 'Stored, encrypted with the system keychain.'
    : 'Stored as plain text - this system has no keychain available.'
}

/** Committed on blur, so a half-typed URL is never saved and then requested. */
function BaseUrlEditor(props: {
  baseUrl: string
  onCommit: (baseUrl: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(props.baseUrl)

  // Re-sync when the main process normalises it (trailing slashes, bad schemes).
  useEffect(() => {
    setDraft(props.baseUrl)
  }, [props.baseUrl])

  return (
    <input
      type="url"
      className="settings__input"
      value={draft}
      placeholder={DEFAULT_BASE_URL}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => props.onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
      aria-label="Server address"
    />
  )
}

/** Same idea for the model id, which is typed by hand for a local server. */
function ModelEditor(props: {
  model: string
  onCommit: (model: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(props.model)

  useEffect(() => {
    setDraft(props.model)
  }, [props.model])

  return (
    <input
      className="settings__input"
      value={draft}
      placeholder="qwen2.5-vl-7b"
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => props.onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
      aria-label="Model id"
    />
  )
}

interface FieldProps {
  label: string
  hint?: string
  children: React.ReactNode
}

function Field({ label, hint, children }: FieldProps): React.JSX.Element {
  return (
    <div className="settings__field">
      <span className="settings__label">{label}</span>
      {children}
      {hint ? <span className="settings__hint">{hint}</span> : null}
    </div>
  )
}

/**
 * Categories are edited as free text and committed on blur rather than per
 * keystroke, so a half-typed line never briefly becomes a real category.
 */
function CategoryEditor(props: {
  categories: string[]
  onCommit: (categories: string[]) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(props.categories.join('\n'))

  // Re-sync when the main process normalises the list (dedupes, trims, caps it).
  useEffect(() => {
    setDraft(props.categories.join('\n'))
  }, [props.categories])

  return (
    <textarea
      className="settings__textarea"
      rows={5}
      value={draft}
      placeholder={'portraits\nlandscape\nblack and white'}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => props.onCommit(draft.split('\n'))}
      aria-label="Categories, one per line"
    />
  )
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
