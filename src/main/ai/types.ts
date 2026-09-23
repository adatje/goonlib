/** Types shared between the classifier and the providers behind it. */

import type { Classification } from './prompt'

/** Media types both providers accept, keyed by the thumbnail format we generate. */
export type ImageMediaType = 'image/webp' | 'image/jpeg' | 'image/png' | 'image/gif'

export interface ImagePayload {
  base64: string
  mediaType: ImageMediaType
}

/**
 * The model declined to answer. Distinct from an error: retrying sends the same
 * image into the same classifier, so the stage records it and moves on rather
 * than burning the item's retries.
 *
 * Only the hosted provider produces this in practice — a local model has no
 * safety classifier in front of it, which is much of the reason to run one.
 */
export interface Refusal {
  status: 'refused'
  reason: string
}

export type ClassifyOutcome = ({ status: 'ok' } & Classification) | Refusal
