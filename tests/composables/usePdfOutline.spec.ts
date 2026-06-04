import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

import type { OutlineNode } from '@/composables/usePdfOutline'
import { usePdfOutline } from '@/composables/usePdfOutline'
import { getDocument, GlobalWorkerOptions } from '@/lib/pdf/pdfjs'
import type { PDFDocumentProxy } from '@/lib/pdf/pdfjs'

/**
 * Same minimal, valid single-page PDF used by the boundary/document tests
 * (200x200 MediaBox, no content stream). It contains NO outline (bookmarks),
 * so it is the guaranteed-real path for the "no outline → []" behavior (Req 5.5).
 */
const MINIMAL_ONE_PAGE_PDF_BASE64 =
  'JVBERi0xLjcKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAyMDAgMjAwXT4+CmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1NCAwMDAwMCBuIAowMDAwMDAwMTA1IDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA0L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKMTcwCiUlRU9G'

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Minimal pieces of the pdfjs `PDFDocumentProxy` surface that `usePdfOutline`
 * touches. We build a fake doc implementing only these to exercise the
 * dest-resolution + tree-mapping logic deterministically (crafting an outlined
 * PDF is heavy / brittle).
 */
type RawOutlineItem = {
  title: string
  dest: string | unknown[] | null
  items: RawOutlineItem[]
}

interface FakeDocConfig {
  outline: RawOutlineItem[] | null
  /** named destination → explicit dest array */
  destinations?: Record<string, unknown[] | null>
  /** ref.num → 0-based page index (getPageIndex) */
  pageIndexByNum?: Record<number, number>
}

function makeFakeDoc(config: FakeDocConfig): PDFDocumentProxy {
  const doc = {
    getOutline(): Promise<RawOutlineItem[] | null> {
      return Promise.resolve(config.outline)
    },
    getDestination(id: string): Promise<unknown[] | null> {
      const dest = config.destinations?.[id]
      return Promise.resolve(dest ?? null)
    },
    getPageIndex(ref: { num: number; gen: number }): Promise<number> {
      const idx = config.pageIndexByNum?.[ref.num]
      if (idx === undefined) {
        return Promise.reject(new Error(`unknown ref ${ref.num}`))
      }
      return Promise.resolve(idx)
    },
  }
  // The fake only implements the methods the composable uses; cast through
  // unknown to satisfy the full proxy type without `any`.
  return doc as unknown as PDFDocumentProxy
}

describe('usePdfOutline', () => {
  describe('load() — no outline → [] (Req 5.5, behavioral/real PDF)', () => {
    // Mirror the boundary test: under vitest the production `?url` workerSrc
    // resolves to a web-root path Node cannot import; point pdfjs at the worker
    // file on disk via file:// so getDocument runs under jsdom (no Worker
    // thread, no canvas). Parsing + getOutline does not require rendering.
    beforeAll(() => {
      const require = createRequire(import.meta.url)
      const workerPath = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs')
      GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
    })

    it('returns [] for a real PDF that has no outline', async () => {
      const data = base64ToBytes(MINIMAL_ONE_PAGE_PDF_BASE64)
      const task = getDocument({ data })
      const doc = await task.promise
      try {
        const outline = usePdfOutline()
        const tree = await outline.load(doc)
        expect(tree).toEqual([])
      } finally {
        await task.destroy()
      }
    })
  })

  describe('load() — tree mapping (Req 5.1, 5.2, fake doc)', () => {
    it('builds the title hierarchy and resolves 1-origin page numbers', async () => {
      const doc = makeFakeDoc({
        outline: [
          {
            title: 'Chapter 1',
            // named destination → resolved via getDestination('ch1')
            dest: 'ch1',
            items: [
              {
                title: '1.1',
                // explicit array dest; first element is the page ref {num:5}
                dest: [{ num: 5, gen: 0 }, { name: 'XYZ' }, 0, 700, null],
                items: [],
              },
            ],
          },
          {
            title: 'No dest',
            dest: null,
            items: [],
          },
        ],
        destinations: {
          // named 'ch1' resolves to explicit array whose page ref is {num:3}
          ch1: [{ num: 3, gen: 0 }, { name: 'XYZ' }, 0, 800, null],
        },
        pageIndexByNum: {
          3: 2, // 0-based → 1-origin 3
          5: 4, // 0-based → 1-origin 5
        },
      })

      const outline = usePdfOutline()
      const tree = await outline.load(doc)

      const expected: OutlineNode[] = [
        {
          title: 'Chapter 1',
          pageIndex: 3, // 1-origin page number (getPageIndex 2 + 1)
          children: [
            {
              title: '1.1',
              pageIndex: 5, // 1-origin page number (getPageIndex 4 + 1)
              children: [],
            },
          ],
        },
        {
          title: 'No dest',
          pageIndex: null, // dest === null → unresolved
          children: [],
        },
      ]

      expect(tree).toEqual(expected)
    })

    it('does not throw when a dest fails to resolve (graceful null)', async () => {
      const doc = makeFakeDoc({
        outline: [
          {
            title: 'Broken ref',
            // explicit array but the ref num is unknown to getPageIndex → reject
            dest: [{ num: 99, gen: 0 }, { name: 'XYZ' }],
            items: [],
          },
          {
            title: 'Missing named dest',
            dest: 'does-not-exist', // getDestination → null
            items: [],
          },
        ],
        pageIndexByNum: { 3: 2 },
        destinations: {},
      })

      const outline = usePdfOutline()
      const tree = await outline.load(doc)

      expect(tree).toEqual([
        { title: 'Broken ref', pageIndex: null, children: [] },
        { title: 'Missing named dest', pageIndex: null, children: [] },
      ])
    })
  })

  describe('resolveDest() (Req 5.2)', () => {
    it('resolves a named (string) destination to a 1-origin page number', async () => {
      const doc = makeFakeDoc({
        outline: null,
        destinations: { ch1: [{ num: 3, gen: 0 }, { name: 'XYZ' }] },
        pageIndexByNum: { 3: 2 },
      })
      const outline = usePdfOutline()
      await expect(outline.resolveDest('ch1', doc)).resolves.toBe(3)
    })

    it('resolves an explicit array destination to a 1-origin page number', async () => {
      const doc = makeFakeDoc({
        outline: null,
        pageIndexByNum: { 5: 4 },
      })
      const outline = usePdfOutline()
      await expect(
        outline.resolveDest([{ num: 5, gen: 0 }, { name: 'XYZ' }], doc),
      ).resolves.toBe(5)
    })

    it('returns null for a null dest', async () => {
      const doc = makeFakeDoc({ outline: null })
      const outline = usePdfOutline()
      await expect(outline.resolveDest(null, doc)).resolves.toBeNull()
    })

    it('returns null for an unknown named destination', async () => {
      const doc = makeFakeDoc({ outline: null, destinations: {} })
      const outline = usePdfOutline()
      await expect(outline.resolveDest('nope', doc)).resolves.toBeNull()
    })

    it('returns null when getPageIndex rejects (unsupported/broken ref)', async () => {
      const doc = makeFakeDoc({ outline: null, pageIndexByNum: { 3: 2 } })
      const outline = usePdfOutline()
      await expect(
        outline.resolveDest([{ num: 99, gen: 0 }], doc),
      ).resolves.toBeNull()
    })

    it('returns null for a malformed dest (empty array / non-ref first element)', async () => {
      const doc = makeFakeDoc({ outline: null })
      const outline = usePdfOutline()
      await expect(outline.resolveDest([], doc)).resolves.toBeNull()
      await expect(outline.resolveDest(['not-a-ref'], doc)).resolves.toBeNull()
      await expect(outline.resolveDest(42, doc)).resolves.toBeNull()
    })
  })
})
