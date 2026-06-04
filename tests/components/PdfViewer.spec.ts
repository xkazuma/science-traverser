import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import PdfViewer from '@/components/PdfViewer.vue'
import { GlobalWorkerOptions } from '@/lib/pdf/pdfjs'
import type { PDFDocumentProxy } from '@/lib/pdf/pdfjs'
import { usePdfStore } from '@/stores/pdfStore'
import { vuetify } from '@/plugins/vuetify'

/**
 * ルート画面オーケストレーション `PdfViewer`（task 5.1, INTEGRATION）の
 * コンポーネントテスト（design.md「UI → PdfViewer ... <v-app> 配下」/
 * 要件 2.1 連続スクロール描画の一連, 7.5 初期案内）。
 *
 * 検証観点（status 駆動の出し分け + 結線）:
 * - 7.5: 初期 idle で「PDF を開いてください」案内（PdfErrorState）を表示し、
 *   PdfViewport は表示しない。
 * - status 切替: loading→PdfLoadingState、error→PdfErrorState エラー表示、
 *   ready→PdfViewport を表示する。
 * - 統合 open パス: DropZone の `file` emit（実 PDF ArrayBuffer）で
 *   status が loading→ready に遷移し Viewport が現れる（起動→ファイル→描画）。
 * - Toolbar `open` で隠しファイル入力の click() が発火する。
 *
 * PdfViewport は実描画（canvas）を行わないが、ready 時に doc/numPages から
 * 寸法を構築する。jsdom では IntersectionObserver/canvas をスタブ済み
 * （tests/setup.ts）。描画配線そのものは PdfViewport.spec の領分のため、
 * ここでは「Viewport コンポーネントが存在する＝出し分けが正しい」までを見る。
 */

// 実 1 ページ PDF（usePdfDocument.spec と同一。200x200 MediaBox）。
const MINIMAL_ONE_PAGE_PDF_BASE64 =
  'JVBERi0xLjcKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAyMDAgMjAwXT4+CmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1NCAwMDAwMCBuIAowMDAwMDAwMTA1IDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA0L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKMTcwCiUlRU9G'

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function makePdfArrayBuffer(): ArrayBuffer {
  return base64ToBytes(MINIMAL_ONE_PAGE_PDF_BASE64).slice().buffer
}

/** 条件成立までポーリングして待つ（非同期 load の反映待ち）。 */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: 条件が時間内に成立しませんでした')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** ダミーの ready 用 doc（doc を読まない出し分けテスト用の最小 proxy）。 */
function makeFakeDoc(numPages: number): PDFDocumentProxy {
  return {
    numPages,
    getPage: () =>
      Promise.resolve({
        rotate: 0,
        getViewport: () => ({ width: 200, height: 200 }),
      }),
    // PdfSidebar が ready 時に usePdfOutline().load(doc) で呼ぶ（しおり無し=null）。
    getOutline: () => Promise.resolve(null),
    destroy: () => Promise.resolve(),
  } as unknown as PDFDocumentProxy
}

function mountViewer(): VueWrapper {
  return mount(PdfViewer, { global: { plugins: [vuetify] }, attachTo: document.body })
}

describe('components/PdfViewer（ルート画面オーケストレーション）', () => {
  // 実 PDF を main-thread fake worker で解析するため、worker を file:// で
  // 上書きする（usePdfDocument.spec と同パターン）。
  beforeAll(() => {
    const require = createRequire(import.meta.url)
    const workerPath = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs')
    GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
  })

  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('7.5 — 初期案内（idle）', () => {
    it('idle では「PDF を開いてください」案内を表示し、Viewport は表示しない', () => {
      const wrapper = mountViewer()
      expect(wrapper.find('[data-test="idle-prompt"]').exists()).toBe(true)
      expect(wrapper.find('.pdf-viewport').exists()).toBe(false)
      expect(wrapper.findComponent({ name: 'PdfViewport' }).exists()).toBe(false)
    })
  })

  describe('status 駆動の出し分け', () => {
    it('loading では PdfLoadingState を表示する', async () => {
      const wrapper = mountViewer()
      const store = usePdfStore()
      store.status = 'loading'
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-test="loading-state"]').exists()).toBe(true)
      expect(wrapper.find('[data-test="idle-prompt"]').exists()).toBe(false)
    })

    it('error ではエラーメッセージ（PdfErrorState）を表示する', async () => {
      const wrapper = mountViewer()
      const store = usePdfStore()
      store.setError({ kind: 'corrupt', message: 'broken' })
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-test="error-alert"]').exists()).toBe(true)
    })

    it('ready では PdfViewport を表示する', async () => {
      const wrapper = mountViewer()
      const store = usePdfStore()
      store.setReady(makeFakeDoc(1), 1)
      await wrapper.vm.$nextTick()
      await wrapper.vm.$nextTick()
      expect(wrapper.findComponent({ name: 'PdfViewport' }).exists()).toBe(true)
      expect(wrapper.find('[data-test="idle-prompt"]').exists()).toBe(false)
    })

    it('ready では Sidebar（ナビゲーションドロワー）を表示する', async () => {
      const wrapper = mountViewer()
      const store = usePdfStore()
      store.setReady(makeFakeDoc(1), 1)
      await wrapper.vm.$nextTick()
      await wrapper.vm.$nextTick()
      expect(wrapper.findComponent({ name: 'PdfSidebar' }).exists()).toBe(true)
    })
  })

  describe('Toolbar open → 隠しファイル入力 click', () => {
    it('Toolbar の open ボタンでファイル入力の click() が呼ばれる', async () => {
      const wrapper = mountViewer()
      const input = wrapper.find('input[type="file"]')
      expect(input.exists()).toBe(true)
      const clickSpy = vi.spyOn(input.element as HTMLInputElement, 'click')
      await wrapper.find('[data-test="open"]').trigger('click')
      expect(clickSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('統合 open パス（起動 → ファイル → 描画）', () => {
    it('DropZone の file emit（実 PDF）で loading→ready に遷移し Viewport が現れる', async () => {
      const wrapper = mountViewer()
      const store = usePdfStore()
      expect(store.status).toBe('idle')

      // DropZone が検証済み ArrayBuffer を emit するのを直接シミュレートする。
      const dropzone = wrapper.findComponent({ name: 'PdfDropZone' })
      expect(dropzone.exists()).toBe(true)
      dropzone.vm.$emit('file', makePdfArrayBuffer())

      await waitFor(() => store.status === 'ready')
      expect(store.numPages).toBe(1)

      await wrapper.vm.$nextTick()
      await wrapper.vm.$nextTick()
      expect(wrapper.findComponent({ name: 'PdfViewport' }).exists()).toBe(true)
    })
  })
})
