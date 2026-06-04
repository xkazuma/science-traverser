import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { mapLoadError, usePdfDocument } from '@/composables/usePdfDocument'
import { GlobalWorkerOptions, InvalidPDFException } from '@/lib/pdf/pdfjs'
import { usePdfStore } from '@/stores/pdfStore'

/**
 * Same minimal, valid single-page PDF used by the boundary test
 * (200x200 MediaBox, no content stream). Parsing + numPages does not require
 * canvas or a real worker thread.
 */
const MINIMAL_ONE_PAGE_PDF_BASE64 =
  'JVBERi0xLjcKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAyMDAgMjAwXT4+CmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1NCAwMDAwMCBuIAowMDAwMDAwMTA1IDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA0L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKMTcwCiUlRU9G'

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // Return a tightly-sized ArrayBuffer copy (decouples from the view's buffer).
  return bytes.slice().buffer
}

describe('usePdfDocument', () => {
  // Behavioral tests parse real bytes through pdfjs's main-thread fake worker.
  // The production boundary configures `workerSrc` via Vite's `?url`, which
  // under vitest resolves to a web-root path Node cannot import; point pdfjs at
  // the same worker file on disk via a `file://` URL (mirrors the boundary
  // test) so getDocument actually runs under jsdom (no Worker thread, no
  // canvas).
  beforeAll(() => {
    const require = createRequire(import.meta.url)
    const workerPath = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs')
    GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
  })

  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('mapLoadError (error 写像: Req 7.3, 7.4)', () => {
    it('maps a PasswordException (by name) to kind "password" (Req 7.4)', () => {
      const err = Object.assign(new Error('No password given'), {
        name: 'PasswordException',
      })
      const mapped = mapLoadError(err)
      expect(mapped.kind).toBe('password')
      expect(typeof mapped.message).toBe('string')
      expect(mapped.message.length).toBeGreaterThan(0)
    })

    it('maps an InvalidPDFException instance to kind "corrupt" (Req 7.3)', () => {
      const err = new InvalidPDFException('bad xref')
      const mapped = mapLoadError(err)
      expect(mapped.kind).toBe('corrupt')
    })

    it('maps an error named "InvalidPDFException" to kind "corrupt" (Req 7.3)', () => {
      const err = Object.assign(new Error('bad'), {
        name: 'InvalidPDFException',
      })
      expect(mapLoadError(err).kind).toBe('corrupt')
    })

    it('maps a generic Error to kind "unknown"', () => {
      expect(mapLoadError(new Error('network down')).kind).toBe('unknown')
    })

    it('maps a non-Error value to kind "unknown"', () => {
      expect(mapLoadError('boom').kind).toBe('unknown')
      expect(mapLoadError(null).kind).toBe('unknown')
    })
  })

  describe('open() — success path (Req 7.1, 7.2)', () => {
    it('parses a valid PDF, sets status=ready, numPages, and reports progress', async () => {
      const store = usePdfStore()
      const doc = usePdfDocument()

      const source = bytesToArrayBuffer(base64ToBytes(MINIMAL_ONE_PAGE_PDF_BASE64))
      await doc.open(source)

      expect(store.status).toBe('ready')
      expect(store.numPages).toBe(1)
      expect(store.doc).not.toBeNull()
      expect(store.error).toBeNull()
      // Progress was wired and resolved to a concrete fraction (Req 7.2).
      expect(store.loadProgress).not.toBeNull()
      if (store.loadProgress !== null) {
        expect(store.loadProgress).toBeGreaterThan(0)
        expect(store.loadProgress).toBeLessThanOrEqual(1)
      }

      doc.close()
    })

    it('passes loading→ready through the store and preserves an undetached source', async () => {
      const store = usePdfStore()
      const doc = usePdfDocument()

      const bytes = base64ToBytes(MINIMAL_ONE_PAGE_PDF_BASE64)
      const source = bytesToArrayBuffer(bytes)
      const originalLength = source.byteLength

      await doc.open(source)

      expect(store.status).toBe('ready')
      // The store's retained source must not have been detached/transferred by
      // pdfjs (we hand pdfjs a copy), so it is still readable.
      expect(store.source).not.toBeNull()
      expect(store.source?.byteLength).toBe(originalLength)

      doc.close()
    })
  })

  describe('open() — corrupt path (Req 7.3)', () => {
    it('sets status=error with kind "corrupt" for garbage bytes', async () => {
      const store = usePdfStore()
      const doc = usePdfDocument()

      const garbage = bytesToArrayBuffer(new Uint8Array([1, 2, 3, 4]))
      await doc.open(garbage)

      expect(store.status).toBe('error')
      expect(store.error).not.toBeNull()
      expect(store.error?.kind).toBe('corrupt')

      doc.close()
    })
  })

  describe('close() — teardown (破棄)', () => {
    it('resets the store to idle', async () => {
      const store = usePdfStore()
      const doc = usePdfDocument()

      await doc.open(bytesToArrayBuffer(base64ToBytes(MINIMAL_ONE_PAGE_PDF_BASE64)))
      expect(store.status).toBe('ready')

      doc.close()
      expect(store.status).toBe('idle')
      expect(store.doc).toBeNull()
      expect(store.source).toBeNull()
    })

    it('is safe to call repeatedly (guards double-destroy)', async () => {
      const doc = usePdfDocument()
      await doc.open(bytesToArrayBuffer(base64ToBytes(MINIMAL_ONE_PAGE_PDF_BASE64)))
      expect(() => {
        doc.close()
        doc.close()
      }).not.toThrow()
    })

    it('is safe to call before any open()', () => {
      const doc = usePdfDocument()
      expect(() => doc.close()).not.toThrow()
    })
  })
})
