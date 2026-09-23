import { describe, expect, it } from 'vitest'
import { instruction, outputSchema, parseClassification } from '../src/main/ai/prompt'

/**
 * `parseClassification` is the boundary between a remote model and rows on disk. The
 * schema guarantees the shape of a *successful* response, so everything here is
 * about what the schema can't promise: ranges, casing, and the failure cases.
 */
describe('parseClassification', () => {
  it('reads labels and confidences', () => {
    const text = JSON.stringify({
      labels: [
        { label: 'portrait', confidence: 0.9 },
        { label: 'outdoors', confidence: 0.4 },
      ],
    })

    expect(parseClassification(text, []).labels).toEqual([
      { label: 'portrait', confidence: 0.9 },
      { label: 'outdoors', confidence: 0.4 },
    ])
  })

  it('clamps confidence into 0..1', () => {
    // The schema can't express numeric bounds, so an out-of-range value is a
    // realistic response rather than a hypothetical one.
    const text = JSON.stringify({
      labels: [
        { label: 'high', confidence: 4 },
        { label: 'low', confidence: -2 },
        { label: 'nonsense', confidence: Number.NaN },
      ],
    })

    expect(parseClassification(text, []).labels).toEqual([
      { label: 'high', confidence: 1 },
      { label: 'low', confidence: 0 },
      { label: 'nonsense', confidence: 0 },
    ])
  })

  it('keeps only labels from the configured vocabulary', () => {
    const text = JSON.stringify({
      labels: [
        { label: 'portrait', confidence: 0.9 },
        { label: 'something else entirely', confidence: 0.9 },
      ],
    })

    expect(parseClassification(text, ['portrait', 'landscape']).labels).toEqual([
      { label: 'portrait', confidence: 0.9 },
    ])
  })

  it("snaps a label back to the user's own casing", () => {
    // Collections are matched case-insensitively, so a label that comes back as
    // 'Portrait' must still file into the 'portrait' the user typed — otherwise
    // the collection name flips depending on which item was classified first.
    const text = JSON.stringify({ labels: [{ label: 'PORTRAIT', confidence: 0.8 }] })

    expect(parseClassification(text, ['portrait']).labels).toEqual([{ label: 'portrait', confidence: 0.8 }])
  })

  it('drops duplicates, keeping the first', () => {
    const text = JSON.stringify({
      labels: [
        { label: 'portrait', confidence: 0.9 },
        { label: 'Portrait', confidence: 0.1 },
      ],
    })

    expect(parseClassification(text, []).labels).toEqual([{ label: 'portrait', confidence: 0.9 }])
  })

  it('ignores blank and non-string labels', () => {
    const text = JSON.stringify({
      labels: [
        { label: '   ', confidence: 0.9 },
        { label: 42, confidence: 0.9 },
        { label: 'real', confidence: 0.9 },
      ],
    })

    expect(parseClassification(text, []).labels).toEqual([{ label: 'real', confidence: 0.9 }])
  })

  it('trims surrounding whitespace', () => {
    const text = JSON.stringify({ labels: [{ label: '  portrait  ', confidence: 0.5 }] })
    expect(parseClassification(text, []).labels).toEqual([{ label: 'portrait', confidence: 0.5 }])
  })

  it('returns nothing rather than throwing on unparseable output', () => {
    // A throw here would mark the item errored and have every later scan retry
    // it, paying for the same broken response each time.
    expect(parseClassification('not json at all', []).labels).toEqual([])
    expect(parseClassification('', []).labels).toEqual([])
    expect(parseClassification('null', []).labels).toEqual([])
    expect(parseClassification(JSON.stringify({ labels: 'nope' }), []).labels).toEqual([])
    expect(parseClassification(JSON.stringify({}), []).labels).toEqual([])
  })
})

/** The shape `outputSchema` produces, spelled out so the assertions can index it. */
interface LabelSchema {
  additionalProperties: boolean
  properties: {
    labels: {
      items: {
        additionalProperties: boolean
        properties: { label: { type: string; enum?: string[] } }
      }
    }
  }
}

function readSchema(categories: string[]): LabelSchema {
  return outputSchema(categories) as unknown as LabelSchema
}

describe('outputSchema', () => {
  it('pins labels to an enum when categories are configured', () => {
    const schema = readSchema(['portrait', 'landscape'])
    expect(schema.properties.labels.items.properties.label.enum).toEqual(['portrait', 'landscape'])
  })

  it('leaves the label open when no categories are configured', () => {
    const schema = readSchema([])
    expect(schema.properties.labels.items.properties.label).toEqual({ type: 'string' })
  })

  it('closes every object, which structured outputs requires', () => {
    // `additionalProperties: false` is not optional polish here — the API
    // rejects a schema without it on every object.
    const schema = readSchema(['a'])
    expect(schema.additionalProperties).toBe(false)
    expect(schema.properties.labels.items.additionalProperties).toBe(false)
  })
})

describe('instruction', () => {
  it('asks for a choice from the list when there is one', () => {
    expect(instruction(['portrait'])).toContain('provided list')
  })

  it('asks for open labels when there is no list', () => {
    expect(instruction([])).toContain('up to five')
  })
})

describe('captions', () => {
  it('is absent from the schema unless asked for', () => {
    // Requesting one costs tokens on every item, so it must be opt-in all the
    // way down rather than something the schema quietly always allows.
    const off = outputSchema([], false) as unknown as {
      properties: Record<string, unknown>
      required: string[]
    }
    expect(off.properties.caption).toBeUndefined()
    expect(off.required).toEqual(['labels'])

    const on = outputSchema([], true) as unknown as {
      properties: Record<string, unknown>
      required: string[]
    }
    expect(on.properties.caption).toEqual({ type: 'string' })
    expect(on.required).toEqual(['labels', 'caption'])
  })

  it('asks for a description only when captions are on', () => {
    expect(instruction([], true)).toContain('caption')
    expect(instruction([], false)).not.toContain('caption')
  })

  it('reads a caption alongside the labels', () => {
    const text = JSON.stringify({
      labels: [{ label: 'portrait', confidence: 0.9 }],
      caption: 'A woman in a red dress standing on a beach at sunset.',
    })

    expect(parseClassification(text, [])).toEqual({
      labels: [{ label: 'portrait', confidence: 0.9 }],
      caption: 'A woman in a red dress standing on a beach at sunset.',
    })
  })

  it('collapses whitespace, since the caption is shown on one line', () => {
    const text = JSON.stringify({ labels: [], caption: '  A cat.\n\n  On a mat.  ' })
    expect(parseClassification(text, []).caption).toBe('A cat. On a mat.')
  })

  it('treats a blank caption as none at all', () => {
    // Storing '' would make the item look captioned and stop it being requeued.
    expect(parseClassification(JSON.stringify({ labels: [], caption: '   ' }), []).caption).toBeNull()
    expect(parseClassification(JSON.stringify({ labels: [] }), []).caption).toBeNull()
    expect(parseClassification(JSON.stringify({ labels: [], caption: 42 }), []).caption).toBeNull()
  })

  it('truncates a runaway caption', () => {
    const text = JSON.stringify({ labels: [], caption: 'x'.repeat(5000) })
    expect(parseClassification(text, []).caption).toHaveLength(2000)
  })
})
