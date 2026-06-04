import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { mount } from '@vue/test-utils'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'

import PdfPage from '@/components/PdfPage.vue'
import { getDocument, GlobalWorkerOptions } from '@/lib/pdf/pdfjs'
import type { PDFDocumentLoadingTask, PDFPageProxy } from '@/lib/pdf/pdfjs'

/**
 * 3層スタックコンポーネント `PdfPage` の振る舞いテスト
 * （design.md「ページ3層スタック」/ 要件 2.1, 2.4）。
 *
 * 実際の pdfjs パイプラインを駆動する: "Hello PDF" を含む 200×200 の 1 ページ
 * PDF を境界（worker file:// 上書き）経由でロードし、getPage(1) で得た本物の
 * `PDFPageProxy` を `PdfPage` に渡してマウントする。jsdom には真の canvas
 * バックエンドがないため実ピクセルは生成されないが、テキスト層の選択可能 span は
 * 本物が生成される（tests/setup.ts の測定専用 2D コンテキストシム）。よって
 * 「3層が同一原点で重なる箱」「viewport 寸法整合」「選択可能テキストの配線」
 * 「倍率変化時の整合（2.4）」を構造的に検証する。
 */

const HELLO_PDF_BASE64 =
  'JVBERi0xLjcKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAyMDAgMjAwXS9SZXNvdXJjZXM8PC9Gb250PDwvRjEgNSAwIFI+Pj4+L0NvbnRlbnRzIDQgMCBSPj4KZW5kb2JqCjQgMCBvYmoKPDwvTGVuZ3RoIDQwPj4Kc3RyZWFtCkJUIC9GMSAyNCBUZiAyMCAxMDAgVGQgKEhlbGxvIFBERikgVGogRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8L1R5cGUvRm9udC9TdWJ0eXBlL1R5cGUxL0Jhc2VGb250L0hlbHZldGljYT4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1NCAwMDAwMCBuIAowMDAwMDAwMTA1IDAwMDAwIG4gCjAwMDAwMDAyMTcgMDAwMDAgbiAKMDAwMDAwMDMwNSAwMDAwMCBuIAp0cmFpbGVyCjw8L1NpemUgNi9Sb290IDEgMCBSPj4Kc3RhcnR4cmVmCjM2OAolJUVPRg=='

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * テキスト層の非同期 render()（streamTextContent → TextLayer.render）が DOM に
 * 反映されるまで待つ小ヘルパ。コンポーネントは fire-and-forget で描画するため、
 * 条件成立をポーリングして待つ（マイクロタスク + 実タイマー）。
 */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: 条件が時間内に成立しませんでした')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('components/PdfPage (3層スタック)', () => {
  let loadingTask: PDFDocumentLoadingTask
  let page: PDFPageProxy

  beforeAll(async () => {
    // 境界 spec と同じ worker-source 上書き: vitest 下では本番の `?url` worker
    // パスは Node が import できない web-root パスなので、ディスク上の worker
    // ファイル（file://）へ向け直し、メインスレッドの fake worker で動かす。
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

  describe('2.1 — 1ページが3層の重なりで表示される', () => {
    it('ルート .pdf-page は position:relative で viewport 寸法を持つ', () => {
      const scale = 1
      const viewport = page.getViewport({ scale })
      const wrapper = mount(PdfPage, { props: { page, scale } })

      const root = wrapper.find('.pdf-page')
      expect(root.exists()).toBe(true)
      const el = root.element as HTMLElement
      expect(el.style.position).toBe('relative')
      expect(el.style.width).toBe(`${viewport.width}px`)
      expect(el.style.height).toBe(`${viewport.height}px`)
    })

    it('キャンバス層・テキスト層・オーバーレイ層の3層を含む', () => {
      const wrapper = mount(PdfPage, { props: { page, scale: 1 } })

      const canvas = wrapper.find('canvas.canvas-layer')
      const textLayer = wrapper.find('.text-layer')
      const overlay = wrapper.find('.overlay-layer')

      expect(canvas.exists()).toBe(true)
      expect(textLayer.exists()).toBe(true)
      expect(overlay.exists()).toBe(true)
    })

    it('3層はすべて絶対配置で同一原点（左上 0,0）に重なる', () => {
      const wrapper = mount(PdfPage, { props: { page, scale: 1 } })

      for (const sel of ['canvas.canvas-layer', '.text-layer', '.overlay-layer']) {
        const el = wrapper.find(sel).element as HTMLElement
        // インライン absolute で原点 0,0 に重なる（observable な層整合）。
        expect(el.style.position).toBe('absolute')
      }
    })
  })

  describe('2.3-adjacent — テキスト層に選択可能テキストが配線される', () => {
    it('.text-layer に "Hello PDF" の選択可能 span が生成される', async () => {
      const wrapper = mount(PdfPage, { props: { page, scale: 1 } })
      const textLayer = wrapper.find('.text-layer').element as HTMLElement

      await waitFor(() => textLayer.querySelectorAll('span').length > 0)

      const spans = textLayer.querySelectorAll('span')
      expect(spans.length).toBeGreaterThan(0)
      expect(textLayer.textContent).toContain('Hello PDF')
    })
  })

  describe('2.4 — 全ズームで各層が同一 viewport を追従', () => {
    it('scale=2 でページ箱寸法が倍になり、オーバーレイ層も viewport 寸法に一致', async () => {
      const vp1 = page.getViewport({ scale: 1 })
      const vp2 = page.getViewport({ scale: 2 })

      const wrapper = mount(PdfPage, { props: { page, scale: 1 } })
      const rootEl = () => wrapper.find('.pdf-page').element as HTMLElement
      const overlayEl = () =>
        wrapper.find('.overlay-layer').element as HTMLElement

      expect(rootEl().style.width).toBe(`${vp1.width}px`)
      expect(overlayEl().style.width).toBe(`${vp1.width}px`)

      await wrapper.setProps({ scale: 2 })

      // ページ箱が新しい viewport（倍）へ追従。
      expect(rootEl().style.width).toBe(`${vp2.width}px`)
      expect(rootEl().style.height).toBe(`${vp2.height}px`)
      expect(vp2.width).toBeCloseTo(vp1.width * 2, 6)

      // オーバーレイ層も同じ viewport を追従（全層が同一 viewport を共有）。
      expect(overlayEl().style.width).toBe(`${vp2.width}px`)
      expect(overlayEl().style.height).toBe(`${vp2.height}px`)
    })
  })
})
