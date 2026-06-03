import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

import {
  getDocument,
  GlobalWorkerOptions,
  pdfjsLib,
  version,
} from '@/lib/pdf/pdfjs'

/**
 * A minimal, valid single-page PDF (200x200 MediaBox, no content stream).
 * Used to prove the boundary can actually parse a document and report
 * `numPages` without requiring canvas (rendering) or a worker thread.
 */
const MINIMAL_ONE_PAGE_PDF_BASE64 =
  'JVBERi0xLjcKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAyMDAgMjAwXT4+CmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1NCAwMDAwMCBuIAowMDAwMDAwMTA1IDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA0L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKMTcwCiUlRU9G'

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

describe('lib/pdf/pdfjs boundary', () => {
  // The production boundary sets `workerSrc` via Vite's `?url`, which under
  // vitest resolves to a *web-root* path ("/node_modules/.../pdf.worker.min.mjs")
  // that Node's loader cannot import when pdfjs spins up its main-thread "fake
  // worker". For the behavioral load test we read the configured worker source,
  // verify the boundary's contract against it, then point pdfjs at the same
  // worker file on disk via a `file://` URL so getDocument actually runs in
  // jsdom (no separate Worker thread, no canvas).
  const configuredWorkerSrc = GlobalWorkerOptions.workerSrc

  beforeAll(() => {
    const require = createRequire(import.meta.url)
    const workerPath = require.resolve(
      'pdfjs-dist/build/pdf.worker.min.mjs',
    )
    GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
  })

  it('configures a non-empty, non-CDN worker source', () => {
    const src = configuredWorkerSrc
    expect(typeof src).toBe('string')
    expect(src.length).toBeGreaterThan(0)
    expect(src).not.toMatch(/^https?:\/\//)
    expect(src).not.toMatch(/cdn|unpkg|jsdelivr|cdnjs/i)
  })

  it('exposes the pdfjs singleton whose version matches getDocument', () => {
    expect(pdfjsLib.getDocument).toBe(getDocument)
    expect(version).toBe(pdfjsLib.version)
    expect(version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('loads a minimal PDF and reports numPages === 1', async () => {
    const data = base64ToBytes(MINIMAL_ONE_PAGE_PDF_BASE64)
    // Runs on pdfjs's main-thread fake worker (no real Worker thread, no
    // canvas). Parsing + numPages does not require rendering.
    const task = getDocument({ data })
    const doc = await task.promise
    try {
      expect(doc.numPages).toBe(1)
    } finally {
      // `task.destroy()` tears down the document proxy and main-thread worker.
      await task.destroy()
    }
  })
})
