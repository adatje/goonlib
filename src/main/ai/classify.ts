/**
 * Stage 5 of the scan: ask a model what each item is, and optionally file it.
 *
 * Unlike the other stages this one costs the user money per item and depends on
 * a remote service, so it is the only stage that is off by default and the only
 * one that can be switched off mid-scan.
 */

import { access } from 'node:fs/promises'
import type { AiSettings, StageState } from '@shared/types'
import { thumbPathFor } from '../cache'
import { addToCollection, findOrCreateCollection } from '../db/collections'
import { applyClassification } from '../db/labels'
import { classifyImage } from './client'
import type { ScoredLabel } from './prompt'

export interface ClassifyResult {
  state: StageState
  labels: ScoredLabel[]
  /** Set when the model declined, so the caller can log it without counting an error. */
  refusal?: string
}

/**
 * Classifies one item and records the outcome.
 *
 * Returns the stage state rather than throwing for the outcomes that aren't
 * failures — a missing thumbnail or a refusal both mean "nothing more to do
 * here", and treating them as errors would have the scan retry them forever.
 */
export async function classifyItem(
  mediaId: number,
  settings: AiSettings,
  signal?: AbortSignal,
): Promise<ClassifyResult> {
  const thumb = thumbPathFor(mediaId)

  // The thumbnail stage runs first, but an item whose thumbnail failed or was
  // skipped has nothing to send.
  try {
    await access(thumb)
  } catch {
    return { state: 'skipped', labels: [] }
  }

  const outcome = await classifyImage(thumb, settings, signal)

  if (outcome.status === 'refused') {
    // Recorded as 'skipped', not 'error': the same image through the same
    // classifier gets the same answer, so retrying only spends money.
    applyClassification(mediaId, { labels: [], caption: null })
    return { state: 'skipped', labels: [], refusal: outcome.reason }
  }

  applyClassification(mediaId, outcome)

  if (settings.autoSort) {
    autoSort(mediaId, outcome.labels, settings.minConfidence)
  }

  return { state: 'done', labels: outcome.labels }
}

/**
 * Files an item into a collection per confident label.
 *
 * Collections are additive and non-destructive — nothing on disk moves, and an
 * item the user later pulls out by hand will be put back only if the item is
 * reclassified. That is the tradeoff for having this run unattended.
 */
function autoSort(mediaId: number, labels: ScoredLabel[], minConfidence: number): void {
  for (const entry of labels) {
    if (entry.confidence < minConfidence) continue

    try {
      const collection = findOrCreateCollection(entry.label)
      addToCollection(collection.id, [mediaId], 'ai')
    } catch (err) {
      // One bad label shouldn't cost the item its other labels, which are
      // already saved by this point.
      console.error(`[ai] could not file ${mediaId} under "${entry.label}":`, err)
    }
  }
}
