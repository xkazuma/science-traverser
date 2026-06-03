import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import PdfViewport from '@/components/PdfViewport.vue'
import { getDocument, GlobalWorkerOptions } from '@/lib/pdf/pdfjs'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from '@/lib/pdf/pdfjs'
import { usePdfStore } from '@/stores/pdfStore'
import {
  lastIntersectionObserver,
  makeIntersectionEntry,
  resetIntersectionObservers,
} from '../setup'

/**
 * スクロール容器 `PdfViewport` の振る舞いテスト
 * （design.md「UI → PdfViewport」「ページジャンプ」/ 要件 2.1, 3.2, 3.4）。
 *
 * 実 pdfjs パイプラインを駆動するため、テスト専用に生成した 3 ページ PDF
 * （MediaBox 高さ 200 / 300 / 250、scale=1・gap=0 で offsetOf = 0 / 200 / 500）を
 * 境界（worker file:// 上書き）経由でロードし、store.setReady で ready 状態にして
 * からマウントする。可視判定（IntersectionObserver）は jsdom に実体が無いため
 * tests/setup.ts の制御可能スタブにシンセティック entry を流して駆動する。
 *
 * 検証観点:
 * - 2.1 連続表示: 全ページのプレースホルダ + 総高スペーサーが作られ、可視ページに
 *   PdfPage（3層）が描画される。
 * - 3.4 ジャンプ: requestGoToPage(n) → 未描画ページでも offsetOf(n) の絶対位置へ
 *   scrollTop が着地し、pendingScrollTo がクリアされる。
 * - 3.2 追従: 交差比でアクティブページが変わると store.currentPage が追従する。
 */

// MediaBox 高さ 200 / 300 / 250 の 3 ページ PDF（tests 用に生成）。
const THREE_PAGE_PDF_BASE64 =
  'JVBERi0xLjcKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFIgNSAwIFIgNyAwIFJdL0NvdW50IDM+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAyMDAgMjAwXS9SZXNvdXJjZXM8PC9Gb250PDwvRjEgOSAwIFI+Pj4+L0NvbnRlbnRzIDQgMCBSPj4KZW5kb2JqCjQgMCBvYmoKPDwvTGVuZ3RoIDM3Pj4Kc3RyZWFtCkJUIC9GMSAyNCBUZiAyMCAxMDAgVGQgKFBhZ2UgMSkgVGogRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8L1R5cGUvUGFnZS9QYXJlbnQgMiAwIFIvTWVkaWFCb3hbMCAwIDIwMCAzMDBdL1Jlc291cmNlczw8L0ZvbnQ8PC9GMSA5IDAgUj4+Pj4vQ29udGVudHMgNiAwIFI+PgplbmRvYmoKNiAwIG9iago8PC9MZW5ndGggMzc+PgpzdHJlYW0KQlQgL0YxIDI0IFRmIDIwIDEwMCBUZCAoUGFnZSAyKSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjcgMCBvYmoKPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMjAwIDI1MF0vUmVzb3VyY2VzPDwvRm9udDw8L0YxIDkgMCBSPj4+Pi9Db250ZW50cyA4IDAgUj4+CmVuZG9iago4IDAgb2JqCjw8L0xlbmd0aCAzNz4+CnN0cmVhbQpCVCAvRjEgMjQgVGYgMjAgMTAwIFRkIChQYWdlIDMpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKOSAwIG9iago8PC9UeXBlL0ZvbnQvU3VidHlwZS9UeXBlMS9CYXNlRm9udC9IZWx2ZXRpY2E+PgplbmRvYmoKeHJlZgowIDEwCjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU0IDAwMDAwIG4gCjAwMDAwMDAxMTcgMDAwMDAgbiAKMDAwMDAwMDIyOSAwMDAwMCBuIAowMDAwMDAwMzE0IDAwMDAwIG4gCjAwMDAwMDA0MjYgMDAwMDAgbiAKMDAwMDAwMDUxMSAwMDAwMCBuIAowMDAwMDAwNjIzIDAwMDAwIG4gCjAwMDAwMDA3MDggMDAwMDAgbiAKdHJhaWxlcgo8PC9TaXplIDEwL1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKNzcxCiUlRU9G'

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** 条件成立までポーリングして待つ（非同期描画・寸法取得の反映待ち）。 */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: 条件が時間内に成立しませんでした')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('components/PdfViewport (スクロール容器・仮想化ホスト)', () => {
  let loadingTask: PDFDocumentLoadingTask
  let doc: PDFDocumentProxy

  beforeAll(async () => {
    // PdfPage.spec と同じ worker-source 上書き（vitest 下では本番 ?url パスは
    // import 不可なので、ディスク上の worker file:// へ向ける）。
    const require = createRequire(import.meta.url)
    const workerPath = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs')
    GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href

    loadingTask = getDocument({ data: base64ToBytes(THREE_PAGE_PDF_BASE64) })
    doc = await loadingTask.promise
    expect(doc.numPages).toBe(3)
  })

  afterAll(async () => {
    await loadingTask.destroy()
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    resetIntersectionObservers()
  })

  afterEach(() => {
    resetIntersectionObservers()
  })

  /** ready なストアでマウントし、寸法取得（プレースホルダ生成）完了まで待つ。 */
  async function mountReady() {
    const store = usePdfStore()
    store.setReady(doc, doc.numPages)
    const wrapper = mount(PdfViewport)
    await waitFor(
      () => wrapper.findAll('.pdf-placeholder').length === doc.numPages,
    )
    return { store, wrapper }
  }

  describe('2.1 — 連続スクロールで全ページが配置され可視ページが描画される', () => {
    it('全ページのプレースホルダと総高スペーサーを作る', async () => {
      const { wrapper } = await mountReady()

      const host = wrapper.find('.pdf-viewport')
      expect(host.exists()).toBe(true)
      expect((host.element as HTMLElement).style.overflow).toBe('auto')

      const placeholders = wrapper.findAll('.pdf-placeholder')
      expect(placeholders).toHaveLength(3)

      // 総高スペーサー = 高さの総和（gap=0、200+300+250 = 750）。
      const spacer = wrapper.find('.pdf-spacer')
      expect(spacer.exists()).toBe(true)
      expect((spacer.element as HTMLElement).style.height).toBe('750px')

      // 各プレースホルダは offsetTop に絶対配置（0 / 200 / 500）。
      const tops = placeholders.map(
        (p) => (p.element as HTMLElement).style.top,
      )
      expect(tops).toEqual(['0px', '200px', '500px'])
    })

    it('可視ページに PdfPage（3層）が描画される', async () => {
      const { wrapper } = await mountReady()

      // ページ 1 を可視にする（交差を発火）。
      const observer = lastIntersectionObserver()
      const el1 = wrapper.findAll('.pdf-placeholder')[0].element
      observer.callback(
        [makeIntersectionEntry(el1, true, 0.9)],
        observer as unknown as IntersectionObserver,
      )
      await wrapper.vm.$nextTick()

      await waitFor(() => wrapper.find('.pdf-page').exists())
      expect(wrapper.find('canvas.canvas-layer').exists()).toBe(true)
      expect(wrapper.find('.text-layer').exists()).toBe(true)
      expect(wrapper.find('.overlay-layer').exists()).toBe(true)
    })
  })

  describe('3.4 — 未描画ページへのジャンプが正しい位置に着地する', () => {
    it('requestGoToPage(3) で container.scrollTop が offsetOf(3)=500 に着地し pendingScrollTo がクリアされる', async () => {
      const { store, wrapper } = await mountReady()
      const host = wrapper.find('.pdf-viewport').element as HTMLElement

      // ページ 3 は初期状態で可視ではない（描画されていない）。
      // ジャンプ要求 → 監視で offsetOf(3) へスクロール。
      store.requestGoToPage(3)
      expect(store.pendingScrollTo).toBe(3)
      await wrapper.vm.$nextTick()

      // 幾何由来の着地（未描画ページでも offsetOf がプレースホルダから返す）。
      expect(host.scrollTop).toBe(500)
      // 消費されてクリアされる。
      expect(store.pendingScrollTo).toBeNull()
    })

    it('ページ 2 へのジャンプは offsetOf(2)=200 に着地する', async () => {
      const { store, wrapper } = await mountReady()
      const host = wrapper.find('.pdf-viewport').element as HTMLElement

      store.requestGoToPage(2)
      await wrapper.vm.$nextTick()

      expect(host.scrollTop).toBe(200)
      expect(store.pendingScrollTo).toBeNull()
    })
  })

  describe('3.2 — 現在ページ表示がスクロール追従する', () => {
    it('最も可視なページが変わると store.currentPage が追従する', async () => {
      const { store, wrapper } = await mountReady()
      expect(store.currentPage).toBe(1)

      const placeholders = wrapper.findAll('.pdf-placeholder')
      const observer = lastIntersectionObserver()

      // ページ 2 が最も可視。
      observer.callback(
        [
          makeIntersectionEntry(placeholders[0].element, true, 0.2),
          makeIntersectionEntry(placeholders[1].element, true, 0.8),
          makeIntersectionEntry(placeholders[2].element, true, 0.1),
        ],
        observer as unknown as IntersectionObserver,
      )
      await wrapper.vm.$nextTick()
      expect(store.currentPage).toBe(2)

      // スクロールしてページ 3 が支配的に。
      observer.callback(
        [
          makeIntersectionEntry(placeholders[1].element, true, 0.3),
          makeIntersectionEntry(placeholders[2].element, true, 0.9),
        ],
        observer as unknown as IntersectionObserver,
      )
      await wrapper.vm.$nextTick()
      expect(store.currentPage).toBe(3)
    })
  })
})
