import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, markRaw } from 'vue'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { VLayout } from 'vuetify/components'

import PdfSidebar from '@/components/PdfSidebar.vue'
import PdfThumbnail from '@/components/PdfThumbnail.vue'
import type { OutlineNode, UsePdfOutline } from '@/composables/usePdfOutline'
import { getDocument, GlobalWorkerOptions } from '@/lib/pdf/pdfjs'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from '@/lib/pdf/pdfjs'
import { usePdfStore } from '@/stores/pdfStore'
import { vuetify } from '@/plugins/vuetify'

/**
 * クローム部品 `PdfSidebar`（アウトライン木 + サムネイル一覧の統合）の振る舞い
 * テスト（design.md「UI → PdfSidebar / PdfThumbnail」/ 要件 5.1, 5.2, 5.5）。
 *
 * アウトライン内容を決定的に制御するため `usePdfOutline` をモックし、`load()` が
 * 既知の木を解決するようにする。サムネイル一覧は実 pdfjs パイプラインを駆動する
 * 実 PDF を store に載せてから埋め込む（PdfThumbnail.spec と同じ 3 ページ PDF）。
 * 実ピクセルは jsdom では出ないため `usePdfPageRender` をモックする。
 *
 * 検証観点:
 * - 5.1: アウトライン木のタイトル階層が一覧表示される。
 * - 5.2: アウトライン項目選択で store.requestGoToPage(移動先) を呼ぶ。
 * - 5.5: アウトラインが無い（空配列）ときその旨を表示する。
 * - サムネイル一覧として PdfThumbnail を内包する。
 */

const THREE_PAGE_PDF_BASE64 =
  'JVBERi0xLjcKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFIgNSAwIFIgNyAwIFJdL0NvdW50IDM+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAyMDAgMjAwXS9SZXNvdXJjZXM8PC9Gb250PDwvRjEgOSAwIFI+Pj4+L0NvbnRlbnRzIDQgMCBSPj4KZW5kb2JqCjQgMCBvYmoKPDwvTGVuZ3RoIDM3Pj4Kc3RyZWFtCkJUIC9GMSAyNCBUZiAyMCAxMDAgVGQgKFBhZ2UgMSkgVGogRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8L1R5cGUvUGFnZS9QYXJlbnQgMiAwIFIvTWVkaWFCb3hbMCAwIDIwMCAzMDBdL1Jlc291cmNlczw8L0ZvbnQ8PC9GMSA5IDAgUj4+Pj4vQ29udGVudHMgNiAwIFI+PgplbmRvYmoKNiAwIG9iago8PC9MZW5ndGggMzc+PgpzdHJlYW0KQlQgL0YxIDI0IFRmIDIwIDEwMCBUZCAoUGFnZSAyKSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjcgMCBvYmoKPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMjAwIDI1MF0vUmVzb3VyY2VzPDwvRm9udDw8L0YxIDkgMCBSPj4+Pi9Db250ZW50cyA4IDAgUj4+CmVuZG9iago4IDAgb2JqCjw8L0xlbmd0aCAzNz4+CnN0cmVhbQpCVCAvRjEgMjQgVGYgMjAgMTAwIFRkIChQYWdlIDMpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKOSAwIG9iago8PC9UeXBlL0ZvbnQvU3VidHlwZS9UeXBlMS9CYXNlRm9udC9IZWx2ZXRpY2E+PgplbmRvYmoKeHJlZgowIDEwCjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU0IDAwMDAwIG4gCjAwMDAwMDAxMTcgMDAwMDAgbiAKMDAwMDAwMDIyOSAwMDAwMCBuIAowMDAwMDAwMzE0IDAwMDAwIG4gCjAwMDAwMDA0MjYgMDAwMDAgbiAKMDAwMDAwMDUxMSAwMDAwMCBuIAowMDAwMDAwNjIzIDAwMDAwIG4gCjAwMDAwMDA3MDggMDAwMDAgbiAKdHJhaWxlcgo8PC9TaXplIDEwL1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKNzcxCiUlRU9G'

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** 条件成立までポーリングして待つ（非同期 load の反映待ち）。 */
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

// PdfThumbnail は実ピクセルを描かない（jsdom）。render/cancel をモックして埋め込み
// 部品が成立するようにする（描画配線は PdfThumbnail.spec の領分）。
vi.mock('@/composables/usePdfPageRender', () => ({
  usePdfPageRender: () => ({
    render: vi.fn(() => Promise.resolve()),
    cancel: vi.fn(),
  }),
}))

// usePdfOutline を差し替え、テストごとに `load` の解決値を設定する。
const loadMock = vi.fn<UsePdfOutline['load']>()
const resolveDestMock = vi.fn<UsePdfOutline['resolveDest']>(() =>
  Promise.resolve(null),
)

vi.mock('@/composables/usePdfOutline', () => ({
  usePdfOutline: (): UsePdfOutline => ({
    load: loadMock,
    resolveDest: resolveDestMock,
  }),
}))

describe('components/PdfSidebar（アウトライン + サムネイル）', () => {
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
    loadMock.mockReset()
    resolveDestMock.mockClear()
  })

  // VNavigationDrawer は祖先の layout（<v-app>/<v-layout>）の inject を要求するため、
  // テストでは <v-layout> でラップして PdfSidebar をマウントする（本番でも <v-app>
  // 配下に置かれる: design.md「PdfViewer ... <v-app> 配下」）。
  const Host = defineComponent({
    name: 'SidebarHost',
    components: { PdfSidebar },
    setup() {
      return () => h('div', [h(VLayout, () => h(PdfSidebar))])
    },
  })

  /** 与えた outline 木で ready なストアにしてマウントし、load 反映を待つ。 */
  async function mountWithOutline(tree: OutlineNode[]): Promise<{
    store: ReturnType<typeof usePdfStore>
    wrapper: VueWrapper
  }> {
    loadMock.mockResolvedValue(tree)
    const store = usePdfStore()
    store.setReady(markRaw(doc), doc.numPages)
    const wrapper = mount(Host, { global: { plugins: [vuetify] } })
    await waitFor(() => loadMock.mock.calls.length >= 1)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    return { store, wrapper }
  }

  describe('5.1 — アウトライン一覧表示', () => {
    it('アウトライン木のタイトル階層を表示する', async () => {
      // pageIndex は 1-origin ページ番号。テスト PDF は 3 ページなので範囲内
      // （store.requestGoToPage が範囲外を無視するため）。
      const tree: OutlineNode[] = [
        {
          title: 'Chapter 1',
          pageIndex: 2,
          children: [{ title: '1.1', pageIndex: 3, children: [] }],
        },
      ]
      const { wrapper } = await mountWithOutline(tree)

      const titles = wrapper
        .findAll('[data-test="outline-node"]')
        .map((n) => n.text())
      expect(titles).toContain('Chapter 1')
      expect(titles).toContain('1.1')
    })
  })

  describe('5.2 — アウトライン選択で移動先へ移動', () => {
    it('子ノードクリックで requestGoToPage(その移動先) を呼ぶ', async () => {
      // pageIndex は 1-origin ページ番号。テスト PDF は 3 ページなので範囲内
      // （store.requestGoToPage が範囲外を無視するため）。
      const tree: OutlineNode[] = [
        {
          title: 'Chapter 1',
          pageIndex: 2,
          children: [{ title: '1.1', pageIndex: 3, children: [] }],
        },
      ]
      const { wrapper, store } = await mountWithOutline(tree)
      const spy = vi.spyOn(store, 'requestGoToPage')

      const node = wrapper
        .findAll('[data-test="outline-node"]')
        .find((n) => n.text() === '1.1')
      expect(node).toBeDefined()
      await node!.trigger('click')

      expect(spy).toHaveBeenCalledWith(3)
      expect(store.pendingScrollTo).toBe(3)
    })

    it('pageIndex が null のノードはジャンプ要求を出さない', async () => {
      const tree: OutlineNode[] = [
        { title: 'Front matter', pageIndex: null, children: [] },
      ]
      const { wrapper, store } = await mountWithOutline(tree)
      const spy = vi.spyOn(store, 'requestGoToPage')

      const node = wrapper
        .findAll('[data-test="outline-node"]')
        .find((n) => n.text() === 'Front matter')
      expect(node).toBeDefined()
      await node!.trigger('click')

      expect(spy).not.toHaveBeenCalled()
      expect(store.pendingScrollTo).toBeNull()
    })
  })

  describe('5.5 — アウトラインが無いことが分かる表示', () => {
    it('空のアウトラインで「アウトラインがありません」を表示する', async () => {
      const { wrapper } = await mountWithOutline([])
      expect(wrapper.find('[data-test="outline-empty"]').exists()).toBe(true)
      expect(wrapper.find('[data-test="outline-empty"]').text()).toContain(
        'アウトラインがありません',
      )
      expect(wrapper.findAll('[data-test="outline-node"]')).toHaveLength(0)
    })
  })

  describe('5.7 — 現在ページのアウトライン強調', () => {
    // pageIndex <= currentPage で最大のノード（現在ページを含むしおり）を強調する。
    const tree: OutlineNode[] = [
      {
        title: 'Chapter 1',
        pageIndex: 1,
        children: [{ title: '1.1', pageIndex: 2, children: [] }],
      },
      { title: 'Chapter 2', pageIndex: 3, children: [] },
    ]

    function currentTitles(wrapper: VueWrapper): string[] {
      return wrapper
        .findAll('[data-test="outline-node"]')
        .filter((n) => n.classes().includes('is-current'))
        .map((n) => n.text())
    }

    it('現在ページ以下で最大の pageIndex のノードを is-current で強調する', async () => {
      const { wrapper, store } = await mountWithOutline(tree)

      // currentPage=2 → 強調は '1.1'(pageIndex 2)。
      store.setCurrentPage(2)
      await wrapper.vm.$nextTick()
      expect(currentTitles(wrapper)).toEqual(['1.1'])

      // currentPage=3 → 強調は 'Chapter 2'(pageIndex 3)。
      store.setCurrentPage(3)
      await wrapper.vm.$nextTick()
      expect(currentTitles(wrapper)).toEqual(['Chapter 2'])

      // currentPage=1 → 強調は 'Chapter 1'(pageIndex 1)。
      store.setCurrentPage(1)
      await wrapper.vm.$nextTick()
      expect(currentTitles(wrapper)).toEqual(['Chapter 1'])
    })

    it('現在ページより前に該当しおりが無い場合は強調しない', async () => {
      // 全 pageIndex が currentPage より大きい木。
      const laterTree: OutlineNode[] = [
        { title: 'Chapter A', pageIndex: 2, children: [] },
        { title: 'Chapter B', pageIndex: 3, children: [] },
      ]
      const { wrapper, store } = await mountWithOutline(laterTree)
      store.setCurrentPage(1)
      await wrapper.vm.$nextTick()
      expect(currentTitles(wrapper)).toEqual([])
    })

    it('現在ページ変化で自動スクロール追従しない（強調のみ）', async () => {
      // jsdom は scrollIntoView を実装しないため、検知用スタブを差し込んで
      // 「強調はするがスクロール追従はしない」を確認する。
      const scrollIntoView = vi.fn()
      const proto = Element.prototype as unknown as {
        scrollIntoView?: () => void
      }
      proto.scrollIntoView = scrollIntoView
      try {
        const { wrapper, store } = await mountWithOutline(tree)
        store.setCurrentPage(3)
        await wrapper.vm.$nextTick()
        // 強調は反映されるが、アウトライン側のスクロール追従は起こさない。
        expect(currentTitles(wrapper)).toEqual(['Chapter 2'])
        expect(scrollIntoView).not.toHaveBeenCalled()
      } finally {
        delete proto.scrollIntoView
      }
    })
  })

  describe('サムネイル一覧の内包', () => {
    it('サムネイルタブで PdfThumbnail を埋め込む', async () => {
      const { wrapper } = await mountWithOutline([])
      // サムネイルタブを選択して該当ペインを表示する。
      await wrapper.find('[data-test="tab-thumbnails"]').trigger('click')
      await wrapper.vm.$nextTick()
      await wrapper.vm.$nextTick()
      expect(wrapper.findComponent(PdfThumbnail).exists()).toBe(true)
    })
  })
})
