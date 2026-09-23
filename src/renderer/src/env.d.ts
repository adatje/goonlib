import type { GoonLibApi } from '@shared/types'

declare global {
  interface Window {
    /** Exposed by the preload bridge. See src/preload/index.ts. */
    goonlib: GoonLibApi
  }
}
