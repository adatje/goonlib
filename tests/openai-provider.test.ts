import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AiSettings } from '../src/shared/types'

// The provider reads the stored key through the settings module, which pulls in
// Electron. Only the key matters here, so the module is stubbed.
vi.mock('../src/main/db/settings', () => ({ apiKey: () => null }))

const { classify, listModels, test: testServer } = await import(
  '../src/main/ai/providers/openai'
)

/**
 * A stand-in for LM Studio, serving the two endpoints the provider uses.
 *
 * Worth the setup: the wire format is the highest-risk part of this provider —
 * it is the one thing no type checks and the one thing that silently produces
 * zero labels on every item if it drifts.
 */
let server: Server
let baseUrl: string
/** The last chat request body the stub saw, so the shape can be asserted. */
let lastChat: Record<string, unknown> | null = null

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')

      if (req.url === '/v1/models') {
        res.end(JSON.stringify({ data: [{ id: 'qwen2.5-vl-7b' }, { id: 'llava-1.6' }] }))
        return
      }

      if (req.url === '/v1/chat/completions') {
        lastChat = JSON.parse(body) as Record<string, unknown>

        // Hosted OpenAI-compatible endpoints answer a declined request this way;
        // local servers never do.
        if (lastChat.model === 'refusenik') {
          res.end(JSON.stringify({ choices: [{ message: { refusal: 'not allowed' } }] }))
          return
        }

        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    labels: [
                      { label: 'portrait', confidence: 0.93 },
                      { label: 'bogus', confidence: 0.5 },
                    ],
                  }),
                },
              },
            ],
          }),
        )
        return
      }

      res.statusCode = 404
      res.end('no such endpoint')
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function settingsFor(overrides: Partial<AiSettings> = {}): AiSettings {
  return {
    enabled: true,
    provider: 'openai',
    baseUrl,
    model: 'qwen2.5-vl-7b',
    categories: ['portrait', 'landscape'],
    autoSort: false,
    minConfidence: 0.6,
    concurrency: 4,
    includeVideos: false,
    captions: false,
    ...overrides,
  }
}

const image = { base64: 'AAAA', mediaType: 'image/webp' as const }

describe('openai-compatible provider', () => {
  it('lists the models the server reports, sorted', async () => {
    expect(await listModels(settingsFor())).toEqual(['llava-1.6', 'qwen2.5-vl-7b'])
  })

  it('confirms a loaded model', async () => {
    expect(await testServer(settingsFor())).toContain('qwen2.5-vl-7b is loaded')
  })

  it('reports a model that is not loaded, and names what is', async () => {
    const result = await testServer(settingsFor({ model: 'not-loaded' }))
    expect(result).toContain('not loaded')
    expect(result).toContain('llava-1.6')
  })

  it('classifies, dropping labels outside the vocabulary', async () => {
    // The stub answers with 'bogus' alongside 'portrait'; the vocabulary filter
    // is what stops a local model inventing collections.
    expect(await classify(image, settingsFor())).toEqual({
      status: 'ok',
      labels: [{ label: 'portrait', confidence: 0.93 }],
      caption: null,
    })
  })

  it('sends the chat-completions shape these servers expect', async () => {
    await classify(image, settingsFor())

    const body = lastChat as {
      model: string
      messages: Array<{ role: string; content: unknown }>
      response_format: {
        type: string
        json_schema: { name: string; strict: boolean; schema: Record<string, unknown> }
      }
    }

    expect(body.model).toBe('qwen2.5-vl-7b')
    expect(body.response_format.type).toBe('json_schema')
    expect(body.response_format.json_schema.strict).toBe(true)

    // The image has to ride as a data URI in an `image_url` part — the shape a
    // text-only request would silently omit.
    const parts = body.messages[1]?.content as Array<{ type: string; image_url?: { url: string } }>
    expect(parts.map((part) => part.type)).toEqual(['text', 'image_url'])
    expect(parts[1]?.image_url?.url).toBe('data:image/webp;base64,AAAA')
  })

  it('reports a refusal rather than treating it as an empty answer', async () => {
    // The two are different outcomes for the scan: an empty answer is a done
    // item with no labels, a refusal is one that must not be retried.
    expect(await classify(image, settingsFor({ model: 'refusenik' }))).toEqual({
      status: 'refused',
      reason: 'not allowed',
    })
  })

  it('explains an unreachable server instead of saying "fetch failed"', async () => {
    // Port 9 (discard) is reliably closed. This is the single most likely error
    // in this whole feature — LM Studio installed but its server not started.
    await expect(listModels(settingsFor({ baseUrl: 'http://127.0.0.1:9/v1' }))).rejects.toThrow(
      /is the server running/,
    )
  })

  it('surfaces the status and body of an error response', async () => {
    await expect(
      listModels(settingsFor({ baseUrl: baseUrl.replace('/v1', '/nope') })),
    ).rejects.toThrow(/returned 404: no such endpoint/)
  })
})
