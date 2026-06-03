import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { mount } from '@vue/test-utils'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'

import PdfOverlayLayer from '@/components/PdfOverlayLayer.vue'
import { getDocument, GlobalWorkerOptions } from '@/lib/pdf/pdfjs'
import type { PageViewport, PDFDocumentLoadingTask } from '@/lib/pdf/pdfjs'
import type { PdfPoint, LayerPoint, PdfRect } from '@/lib/pdf/coordinates'

/**
 * Slot-contract LOCK test for `PdfOverlayLayer` (design.md "UI →
 * PdfOverlayLayer（拡張点・要件 8）", requirements 8.1–8.4).
 *
 * A real `PageViewport` is built by loading the same minimal embedded PDF used
 * by the coordinates spec through the real pdfjs boundary, so the scoped-slot
 * converters are exercised against genuine affine math (scale + Y flip) rather
 * than a hand-faked viewport. This proves the layer actually wires
 * `lib/pdf/coordinates` to its slot (8.2), not just exposes truthy functions.
 */
const MINIMAL_ONE_PAGE_PDF_BASE64 =
  'JVBERi0xLjcKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAyMDAgMjAwXT4+CmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1NCAwMDAwMCBuIAowMDAwMDAwMTA1IDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA0L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKMTcwCiUlRU9G'

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

interface CapturedSlotProps {
  viewport: PageViewport
  toLayer: (p: PdfPoint) => LayerPoint
  toPdf: (p: LayerPoint) => PdfPoint
  toLayerRect: (r: PdfRect) => {
    left: number
    top: number
    width: number
    height: number
  }
}

describe('components/PdfOverlayLayer (slot contract lock)', () => {
  let task: PDFDocumentLoadingTask
  let vp1: PageViewport
  let vp2: PageViewport

  beforeAll(async () => {
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

  /** Mount the layer with a capturing scoped slot; returns the captured props. */
  function mountWithCapture(viewport: PageViewport): {
    wrapper: ReturnType<typeof mount>
    captured: CapturedSlotProps
  } {
    let captured: CapturedSlotProps | undefined
    const wrapper = mount(PdfOverlayLayer, {
      props: { viewport },
      slots: {
        default: (props: CapturedSlotProps) => {
          captured = props
          // Render nothing: this slot only captures the contract.
          return undefined
        },
      },
    })
    if (!captured) throw new Error('default slot was never invoked')
    return { wrapper, captured }
  }

  describe('8.2 — scoped slot exposes working coordinate converters', () => {
    it('passes the current viewport to the slot', () => {
      const { captured } = mountWithCapture(vp1)
      expect(captured.viewport.width).toBeCloseTo(vp1.width, 6)
      expect(captured.viewport.height).toBeCloseTo(vp1.height, 6)
    })

    it('exposes toLayer / toPdf / toLayerRect as functions', () => {
      const { captured } = mountWithCapture(vp1)
      expect(typeof captured.toLayer).toBe('function')
      expect(typeof captured.toPdf).toBe('function')
      expect(typeof captured.toLayerRect).toBe('function')
    })

    it('toPdf(toLayer(p)) ≈ p — converters really convert via the layer', () => {
      const { captured } = mountWithCapture(vp1)
      const samples: PdfPoint[] = [
        { x: 0, y: 0 },
        { x: 200, y: 200 },
        { x: 50, y: 60 },
        { x: 137.5, y: 12.25 },
      ]
      for (const p of samples) {
        const back = captured.toPdf(captured.toLayer(p))
        expect(back.x).toBeCloseTo(p.x, 6)
        expect(back.y).toBeCloseTo(p.y, 6)
      }
    })

    it('toLayer applies the Y flip (PDF bottom-left origin → layer bottom)', () => {
      const { captured } = mountWithCapture(vp1)
      const layer = captured.toLayer({ x: 0, y: 0 })
      expect(layer.left).toBeCloseTo(0, 6)
      // bottom-left PDF origin lands near the BOTTOM edge in top-left layer space
      expect(layer.top).toBeCloseTo(vp1.height, 6)
    })

    it('toLayerRect returns a normalized box with positive width/height', () => {
      const { captured } = mountWithCapture(vp1)
      const box = captured.toLayerRect({ x: 40, y: 50, width: 60, height: 30 })
      expect(box.width).toBeGreaterThan(0)
      expect(box.height).toBeGreaterThan(0)
      expect(box.width).toBeCloseTo(60, 6)
      expect(box.height).toBeCloseTo(30, 6)
    })
  })

  describe('8.1 — layer box equals viewport dims at the same origin', () => {
    it('root element style width/height match the viewport', () => {
      const { wrapper } = mountWithCapture(vp1)
      const root = wrapper.find('.overlay-layer')
      expect(root.exists()).toBe(true)
      const el = root.element as HTMLElement
      expect(el.style.width).toBe(`${vp1.width}px`)
      expect(el.style.height).toBe(`${vp1.height}px`)
      // same-origin overlay: absolutely positioned at origin
      expect(el.style.position).toBe('absolute')
    })
  })

  describe('8.3 — dims and converters track viewport/scale changes', () => {
    it('re-mount at a different scale yields different dims and converters', () => {
      const { wrapper, captured } = mountWithCapture(vp2)
      const el = (wrapper.find('.overlay-layer').element as HTMLElement)
      expect(el.style.width).toBe(`${vp2.width}px`)
      expect(el.style.height).toBe(`${vp2.height}px`)
      // scale 2 viewport is twice the scale 1 viewport
      expect(vp2.height).toBeCloseTo(vp1.height * 2, 6)
      // converter reflects the scale-2 viewport (top ≈ 2× the scale-1 result)
      const at2 = captured.toLayer({ x: 0, y: 0 })
      expect(at2.top).toBeCloseTo(vp1.height * 2, 6)
    })

    it('updating the viewport prop updates dims and slot converters', async () => {
      let captured: CapturedSlotProps | undefined
      const wrapper = mount(PdfOverlayLayer, {
        props: { viewport: vp1 },
        slots: {
          default: (props: CapturedSlotProps) => {
            captured = props
            return undefined
          },
        },
      })
      const before = (wrapper.find('.overlay-layer').element as HTMLElement)
        .style.width
      const beforeTop = captured!.toLayer({ x: 0, y: 0 }).top

      await wrapper.setProps({ viewport: vp2 })

      const after = (wrapper.find('.overlay-layer').element as HTMLElement)
        .style.width
      const afterTop = captured!.toLayer({ x: 0, y: 0 }).top

      expect(after).not.toBe(before)
      expect(after).toBe(`${vp2.width}px`)
      expect(afterTop).toBeCloseTo(beforeTop * 2, 6)
    })
  })

  describe('8.4 — phase 1 renders no overlay content', () => {
    it('with no slot provided, the layer has no children', () => {
      const wrapper = mount(PdfOverlayLayer, { props: { viewport: vp1 } })
      const root = wrapper.find('.overlay-layer')
      expect(root.exists()).toBe(true)
      expect((root.element as HTMLElement).children.length).toBe(0)
    })
  })
})
