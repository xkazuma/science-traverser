import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { beforeAll, afterAll, describe, expect, it } from 'vitest'

import { getDocument, GlobalWorkerOptions } from '@/lib/pdf/pdfjs'
import type { PageViewport, PDFDocumentLoadingTask } from '@/lib/pdf/pdfjs'
import {
  toLayerPoint,
  toPdfPoint,
  toLayerRect,
} from '@/lib/pdf/coordinates'

/**
 * A minimal, valid single-page PDF (200x200 MediaBox, no content stream),
 * reused from the task-1.3 boundary spec. Loading it through the real pdfjs
 * `getDocument` lets us obtain a genuine `PageViewport` so the affine math
 * (scale + bottom-left→top-left Y flip) is exercised end-to-end rather than
 * hand-faked. Page size is 200x200 PDF units.
 */
const MINIMAL_ONE_PAGE_PDF_BASE64 =
  'JVBERi0xLjcKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAyMDAgMjAwXT4+CmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1NCAwMDAwMCBuIAowMDAwMDAwMTA1IDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA0L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKMTcwCiUlRU9G'

const PAGE_SIZE = 200

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

describe('lib/pdf/coordinates', () => {
  let task: PDFDocumentLoadingTask
  let vp1: PageViewport
  let vp2: PageViewport

  beforeAll(async () => {
    // Same worker-on-disk trick as the boundary spec: the production `?url`
    // worker path is not importable by Node's loader, so point pdfjs at the
    // installed worker file directly for the main-thread fake worker.
    const require = createRequire(import.meta.url)
    const workerPath = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs')
    GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href

    task = getDocument({ data: base64ToBytes(MINIMAL_ONE_PAGE_PDF_BASE64) })
    const doc = await task.promise
    const page = await doc.getPage(1)
    vp1 = page.getViewport({ scale: 1 })
    vp2 = page.getViewport({ scale: 2 })
  })

  afterAll(async () => {
    await task.destroy()
  })

  const EPS = 1e-6

  describe('round-trip identity: toPdfPoint(toLayerPoint(p)) ≈ p', () => {
    const samplePoints = [
      { x: 0, y: 0 },
      { x: 200, y: 200 },
      { x: 50, y: 60 },
      { x: 137.5, y: 12.25 },
      { x: 200, y: 0 },
    ]

    for (const scaleLabel of ['scale 1.0', 'scale 2.0'] as const) {
      describe(scaleLabel, () => {
        for (const p of samplePoints) {
          it(`recovers (${p.x}, ${p.y})`, () => {
            const vp = scaleLabel === 'scale 1.0' ? vp1 : vp2
            const back = toPdfPoint(vp, toLayerPoint(vp, p))
            expect(back.x).toBeCloseTo(p.x, 6)
            expect(back.y).toBeCloseTo(p.y, 6)
          })
        }
      })
    }
  })

  describe('axis flip: PDF bottom-left origin → layer bottom', () => {
    it('PDF (0,0) maps near the BOTTOM of the layer (top ≈ viewport.height)', () => {
      const layer = toLayerPoint(vp1, { x: 0, y: 0 })
      expect(layer.left).toBeCloseTo(0, 6)
      // bottom-left PDF origin lands at the BOTTOM edge in top-left layer space
      expect(layer.top).toBeCloseTo(vp1.height, 6)
      expect(layer.top).toBeGreaterThan(vp1.height / 2)
    })

    it('PDF top-left corner (0, pageHeight) maps near top=0', () => {
      const layer = toLayerPoint(vp1, { x: 0, y: PAGE_SIZE })
      expect(layer.left).toBeCloseTo(0, 6)
      expect(layer.top).toBeCloseTo(0, 6)
    })

    it('scale doubles the layer extent (DPR is not this module concern)', () => {
      const atScale1 = toLayerPoint(vp1, { x: 0, y: 0 })
      const atScale2 = toLayerPoint(vp2, { x: 0, y: 0 })
      expect(atScale2.top).toBeCloseTo(atScale1.top * 2, 6)
      expect(vp2.height).toBeCloseTo(vp1.height * 2, 6)
    })
  })

  describe('toLayerRect', () => {
    // A PDF rect given in bottom-left origin: corner (40, 50), 60 wide, 30 tall.
    // Top edge in PDF space is y = 50 + 30 = 80. In top-left layer space that
    // top edge becomes top = pageHeight - 80 = 120 (at scale 1).
    const pdfRect = { x: 40, y: 50, width: 60, height: 30 }

    it('produces a normalized box with positive width/height at scale 1', () => {
      const box = toLayerRect(vp1, pdfRect)
      expect(box.width).toBeGreaterThan(0)
      expect(box.height).toBeGreaterThan(0)
      expect(box.width).toBeCloseTo(60, EPS)
      expect(box.height).toBeCloseTo(30, EPS)
      // left = PDF x; top = pageHeight - (y + height) due to Y flip.
      expect(box.left).toBeCloseTo(40, EPS)
      expect(box.top).toBeCloseTo(PAGE_SIZE - (pdfRect.y + pdfRect.height), EPS)
    })

    it('scales the box by the viewport scale', () => {
      const box1 = toLayerRect(vp1, pdfRect)
      const box2 = toLayerRect(vp2, pdfRect)
      expect(box2.width).toBeCloseTo(box1.width * 2, EPS)
      expect(box2.height).toBeCloseTo(box1.height * 2, EPS)
      expect(box2.left).toBeCloseTo(box1.left * 2, EPS)
      expect(box2.top).toBeCloseTo(box1.top * 2, EPS)
    })

    it('matches the corner mapping of toLayerPoint', () => {
      // The layer box must enclose the projected PDF corners. The bottom-left
      // PDF corner (x, y) is the box's bottom-left in layer space; the top-left
      // PDF corner (x, y+height) is the box's top-left.
      const box = toLayerRect(vp1, pdfRect)
      const topLeftCorner = toLayerPoint(vp1, {
        x: pdfRect.x,
        y: pdfRect.y + pdfRect.height,
      })
      expect(box.left).toBeCloseTo(topLeftCorner.left, EPS)
      expect(box.top).toBeCloseTo(topLeftCorner.top, EPS)
    })
  })
})
