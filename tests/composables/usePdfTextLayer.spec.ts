import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { usePdfTextLayer } from '@/composables/usePdfTextLayer'
import { getDocument, GlobalWorkerOptions } from '@/lib/pdf/pdfjs'
import type { PDFDocumentLoadingTask, PDFPageProxy } from '@/lib/pdf/pdfjs'

/**
 * Behavioral tests for the text-layer composable (Req 2.3 — テキストを選択・
 * コピー可能な状態で重ねて表示).
 *
 * Unlike the canvas render path, the pdfjs v6 text layer is jsdom-compatible:
 * `getTextContent()` parses the page's text without canvas/Worker, and the
 * `TextLayer` class lays out selectable <span> nodes into a plain DOM container.
 * So we drive the *real* pipeline here: load a one-page PDF that contains a
 * visible "Hello PDF" string, build its viewport, render the text layer into a
 * div, and assert the container received selectable text matching the glyphs.
 */

/**
 * A minimal, valid single-page PDF (200x200 MediaBox) whose content stream
 * paints the literal text "Hello PDF" with the standard Helvetica font, so
 * `getTextContent()` yields a real, selectable text item.
 */
const HELLO_PDF_BASE64 =
  'JVBERi0xLjcKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAyMDAgMjAwXS9SZXNvdXJjZXM8PC9Gb250PDwvRjEgNSAwIFI+Pj4+L0NvbnRlbnRzIDQgMCBSPj4KZW5kb2JqCjQgMCBvYmoKPDwvTGVuZ3RoIDQwPj4Kc3RyZWFtCkJUIC9GMSAyNCBUZiAyMCAxMDAgVGQgKEhlbGxvIFBERikgVGogRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8L1R5cGUvRm9udC9TdWJ0eXBlL1R5cGUxL0Jhc2VGb250L0hlbHZldGljYT4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1NCAwMDAwMCBuIAowMDAwMDAwMTA1IDAwMDAwIG4gCjAwMDAwMDAyMTcgMDAwMDAgbiAKMDAwMDAwMDMwNSAwMDAwMCBuIAp0cmFpbGVyCjw8L1NpemUgNi9Sb290IDEgMCBSPj4Kc3RhcnR4cmVmCjM2OAolJUVPRg=='

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

describe('usePdfTextLayer', () => {
  // Same worker-source override as the boundary spec: under vitest the
  // production `?url` worker path is a web-root path Node cannot import, so we
  // repoint pdfjs at the worker file on disk (file://) and run on the
  // main-thread fake worker. Text extraction + layout need no real Worker.
  let loadingTask: PDFDocumentLoadingTask
  let page: PDFPageProxy

  beforeAll(async () => {
    const require = createRequire(import.meta.url)
    const workerPath = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs')
    GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href

    loadingTask = getDocument({ data: base64ToBytes(HELLO_PDF_BASE64) })
    const doc = await loadingTask.promise
    page = await doc.getPage(1)
  })

  afterAll(async () => {
    await loadingTask.destroy()
  })

  it('renders selectable text nodes containing the page glyphs', async () => {
    const viewport = page.getViewport({ scale: 1 })
    const container = document.createElement('div')

    const { render } = usePdfTextLayer()
    await render(container, page, viewport)

    // Selectable text elements were generated (v6 TextLayer emits <span>s).
    const spans = container.querySelectorAll('span')
    expect(spans.length).toBeGreaterThan(0)

    // The rendered, selectable text contains the page's visible glyphs.
    expect(container.textContent).toContain('Hello PDF')
  })

  it('overlays the canvas: --scale-factor + layer dims align with the viewport', async () => {
    const scale = 1.5
    const viewport = page.getViewport({ scale })
    const container = document.createElement('div')

    const { render } = usePdfTextLayer()
    await render(container, page, viewport)

    // The composable sets --scale-factor to the viewport scale BEFORE building
    // the layer; v6 positions every glyph (and sizes the layer box) relative to
    // it. Without it the text would be mis-scaled against the canvas (Req 2.4).
    expect(container.style.getPropertyValue('--scale-factor')).toBe(
      String(scale),
    )

    // pdfjs' TextLayer constructor sizes the container to the same scaled page
    // box as the canvas via `--total-scale-factor` (= --scale-factor × DPR), so
    // the layer overlays the canvas at every zoom. The dims are expressed
    // relative to the *unscaled* page (200×200 MediaBox) and resolve, through
    // --scale-factor, to the scaled viewport dims (200 × 1.5 = 300).
    const unscaledPageSize = viewport.width / scale
    expect(unscaledPageSize).toBe(200)
    expect(viewport.width).toBe(300)
    expect(container.style.width).toContain('--total-scale-factor')
    expect(container.style.width).toContain(`${unscaledPageSize}px`)
    expect(container.style.height).toContain('--total-scale-factor')
    expect(container.style.height).toContain(`${unscaledPageSize}px`)
  })

  it('is idempotent: re-rendering clears prior nodes (no duplication)', async () => {
    const viewport = page.getViewport({ scale: 1 })
    const container = document.createElement('div')

    const { render } = usePdfTextLayer()
    await render(container, page, viewport)
    const firstCount = container.querySelectorAll('span').length
    await render(container, page, viewport)
    const secondCount = container.querySelectorAll('span').length

    expect(firstCount).toBeGreaterThan(0)
    expect(secondCount).toBe(firstCount)
  })
})
