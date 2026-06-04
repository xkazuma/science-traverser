import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { markRaw } from 'vue'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import PdfThumbnail from '@/components/PdfThumbnail.vue'
import type { UsePdfPageRender } from '@/composables/usePdfPageRender'
import { getDocument, GlobalWorkerOptions } from '@/lib/pdf/pdfjs'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from '@/lib/pdf/pdfjs'
import { usePdfStore } from '@/stores/pdfStore'
import { vuetify } from '@/plugins/vuetify'

/**
 * クローム部品 `PdfThumbnail`（サムネイル一覧）の振る舞いテスト
 * （design.md「UI → PdfSidebar / PdfThumbnail」/ 要件 5.3, 5.4）。
 *
 * 実 pdfjs パイプラインを駆動するため、PdfViewport.spec と同じ 3 ページ PDF を
 * 境界（worker file:// 上書き）経由でロードし、store.setReady(markRaw(doc), n) で
 * ready 状態にしてからマウントする。
 *
 * 実ピクセルは jsdom では出ないため、`usePdfPageRender` をモックして
 * `render`/`cancel` の呼び出し（配線）を検証する。本物の描画は E2E の領分。
 * 一覧の窓化（仮想化）は jsdom にレイアウト高さが無いと VVirtualScroll が何も
 * 描画しないため、PdfThumbnail は固定アイテム高の窓化リストにフォールバックする。
 * テストは「全 N ページ分の項目が一覧に存在し、可視窓に canvas + ページ番号ラベルが
 * 描画される」「クリックで requestGoToPage(その番号)」「currentPage がハイライト」を
 * 検証する。
 *
 * 検証観点:
 * - 5.3: 全ページのサムネイル項目が一覧化され、各項目にページ番号ラベルと canvas。
 * - 5.4: サムネイルクリックで store.requestGoToPage(その番号) を呼ぶ。
 * - currentPage のサムネイルがハイライトされる。
 */

const THREE_PAGE_PDF_BASE64 =
  'JVBERi0xLjcKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFIgNSAwIFIgNyAwIFJdL0NvdW50IDM+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAyMDAgMjAwXS9SZXNvdXJjZXM8PC9Gb250PDwvRjEgOSAwIFI+Pj4+L0NvbnRlbnRzIDQgMCBSPj4KZW5kb2JqCjQgMCBvYmoKPDwvTGVuZ3RoIDM3Pj4Kc3RyZWFtCkJUIC9GMSAyNCBUZiAyMCAxMDAgVGQgKFBhZ2UgMSkgVGogRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8L1R5cGUvUGFnZS9QYXJlbnQgMiAwIFIvTWVkaWFCb3hbMCAwIDIwMCAzMDBdL1Jlc291cmNlczw8L0ZvbnQ8PC9GMSA5IDAgUj4+Pj4vQ29udGVudHMgNiAwIFI+PgplbmRvYmoKNiAwIG9iago8PC9MZW5ndGggMzc+PgpzdHJlYW0KQlQgL0YxIDI0IFRmIDIwIDEwMCBUZCAoUGFnZSAyKSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjcgMCBvYmoKPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMjAwIDI1MF0vUmVzb3VyY2VzPDwvRm9udDw8L0YxIDkgMCBSPj4+Pi9Db250ZW50cyA4IDAgUj4+CmVuZG9iago4IDAgb2JqCjw8L0xlbmd0aCAzNz4+CnN0cmVhbQpCVCAvRjEgMjQgVGYgMjAgMTAwIFRkIChQYWdlIDMpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKOSAwIG9iago8PC9UeXBlL0ZvbnQvU3VidHlwZS9UeXBlMS9CYXNlRm9udC9IZWx2ZXRpY2E+PgplbmRvYmoKeHJlZgowIDEwCjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU0IDAwMDAwIG4gCjAwMDAwMDAxMTcgMDAwMDAgbiAKMDAwMDAwMDIyOSAwMDAwMCBuIAowMDAwMDAwMzE0IDAwMDAwIG4gCjAwMDAwMDA0MjYgMDAwMDAgbiAKMDAwMDAwMDUxMSAwMDAwMCBuIAowMDAwMDAwNjIzIDAwMDAwIG4gCjAwMDAwMDA3MDggMDAwMDAgbiAKdHJhaWxlcgo8PC9TaXplIDEwL1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKNzcxCiUlRU9G'

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** 条件成立までポーリングして待つ（非同期描画の反映待ち）。 */
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

// 実ピクセルは出ないため render/cancel の配線のみ検証する（PdfCanvasLayer.spec 同様）。
const renderSpy = vi.fn<UsePdfPageRender['render']>(() => Promise.resolve())
const cancelSpy = vi.fn<UsePdfPageRender['cancel']>()

vi.mock('@/composables/usePdfPageRender', () => ({
  usePdfPageRender: (): UsePdfPageRender => ({
    render: renderSpy,
    cancel: cancelSpy,
  }),
}))

describe('components/PdfThumbnail（サムネイル一覧）', () => {
  let loadingTask: PDFDocumentLoadingTask
  let doc: PDFDocumentProxy

  beforeAll(async () => {
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
    renderSpy.mockClear()
    cancelSpy.mockClear()
  })

  afterEach(() => {
    renderSpy.mockClear()
    cancelSpy.mockClear()
  })

  /** ready なストアでマウントし、可視窓のサムネイル描画完了まで待つ。 */
  async function mountReady(): Promise<{
    store: ReturnType<typeof usePdfStore>
    wrapper: VueWrapper
  }> {
    const store = usePdfStore()
    store.setReady(markRaw(doc), doc.numPages)
    const wrapper = mount(PdfThumbnail, { global: { plugins: [vuetify] } })
    await waitFor(() => wrapper.findAll('canvas').length >= 1)
    return { store, wrapper }
  }

  it('doc 未読込では何も描画しない（ガード）', () => {
    const store = usePdfStore()
    store.reset()
    const wrapper = mount(PdfThumbnail, { global: { plugins: [vuetify] } })
    expect(wrapper.findAll('[data-test="thumb-item"]').length).toBe(0)
    expect(renderSpy).not.toHaveBeenCalled()
  })

  describe('5.3 — 全ページのサムネイルが一覧表示される', () => {
    it('全 numPages 分のサムネイル項目を一覧化する', async () => {
      const { wrapper } = await mountReady()
      const items = wrapper.findAll('[data-test="thumb-item"]')
      expect(items).toHaveLength(doc.numPages)
    })

    it('各サムネイル項目にページ番号ラベルがある', async () => {
      const { wrapper } = await mountReady()
      const labels = wrapper
        .findAll('[data-test="thumb-label"]')
        .map((n) => n.text())
      expect(labels).toEqual(['1', '2', '3'])
    })

    it('可視サムネイルに canvas を描画し、小倍率で render が呼ばれる', async () => {
      const { wrapper } = await mountReady()
      // 可視窓には少なくとも 1 つの canvas が描画される。
      expect(wrapper.findAll('canvas').length).toBeGreaterThanOrEqual(1)
      // render は小倍率（< 1）で呼ばれる（サムネイル＝縮小描画）。
      expect(renderSpy).toHaveBeenCalled()
      for (const call of renderSpy.mock.calls) {
        const scaleArg = call[2]
        expect(scaleArg).toBeGreaterThan(0)
        expect(scaleArg).toBeLessThan(1)
      }
    })
  })

  describe('5.4 — サムネイル選択で該当ページへジャンプする', () => {
    it('サムネイルクリックで requestGoToPage(その番号) を呼ぶ', async () => {
      const { wrapper, store } = await mountReady()
      const spy = vi.spyOn(store, 'requestGoToPage')
      const items = wrapper.findAll('[data-test="thumb-item"]')
      await items[2].trigger('click')
      expect(spy).toHaveBeenCalledWith(3)
      expect(store.pendingScrollTo).toBe(3)
    })

    it('別ページのクリックでその番号を要求する', async () => {
      const { wrapper, store } = await mountReady()
      const items = wrapper.findAll('[data-test="thumb-item"]')
      await items[1].trigger('click')
      expect(store.pendingScrollTo).toBe(2)
    })
  })

  describe('current page ハイライト', () => {
    it('store.currentPage のサムネイルに is-current が付く', async () => {
      const { wrapper, store } = await mountReady()
      store.setCurrentPage(2)
      await wrapper.vm.$nextTick()
      const items = wrapper.findAll('[data-test="thumb-item"]')
      expect(items[0].classes()).not.toContain('is-current')
      expect(items[1].classes()).toContain('is-current')
      expect(items[2].classes()).not.toContain('is-current')
    })
  })

  it('アンマウントで in-flight 描画を cancel する', async () => {
    const { wrapper } = await mountReady()
    cancelSpy.mockClear()
    wrapper.unmount()
    expect(cancelSpy).toHaveBeenCalled()
  })
})
