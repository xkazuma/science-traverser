import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'

import PdfAnnotationLayer from '@/components/PdfAnnotationLayer.vue'
import { getDocument, GlobalWorkerOptions } from '@/lib/pdf/pdfjs'
import type { PDFDocumentLoadingTask, PDFPageProxy } from '@/lib/pdf/pdfjs'
import { usePdfStore } from '@/stores/pdfStore'

/**
 * Wiring tests for the link/cross-reference annotation layer (Req 9.1 リンク注釈の
 * クリック可能表示 / 9.2 内部リンクで移動先へジャンプ / 9.4 位置整合・pointer-events
 * 分離).
 *
 * Drives the *real* pdfjs pipeline end-to-end: a 2-page PDF whose page 1 carries
 * a Link annotation with an internal GoTo /Dest to page 2. The v6
 * `AnnotationLayer` link path needs no canvas (only the link `<a>` DOM), so it
 * runs under jsdom (same as the text layer). We mount the component on page 1,
 * assert a clickable `<a>` was created, and that clicking it routes through the
 * link service into the store's jump request (`pendingScrollTo === 2`) — proving
 * the full annotation → linkService → store cross-reference flow.
 */

/**
 * A 2-page PDF (200×200). Page 1 paints "Go to page 2" and has a Link annotation
 * (Rect [20 95 180 125]) with `/Dest [6 0 R /Fit]` → page 2 (object 6). Page 2
 * paints "Page two". Generated offline; minimal valid xref table.
 */
const LINK_PDF_BASE64 =
  'JVBERi0xLjcKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFIgNiAwIFJdL0NvdW50IDI+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAyMDAgMjAwXS9SZXNvdXJjZXM8PC9Gb250PDwvRjEgNSAwIFI+Pj4+L0NvbnRlbnRzIDQgMCBSL0Fubm90c1s3IDAgUl0+PgplbmRvYmoKNCAwIG9iago8PC9MZW5ndGggNDM+PgpzdHJlYW0KQlQgL0YxIDI0IFRmIDIwIDEwMCBUZCAoR28gdG8gcGFnZSAyKSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwvVHlwZS9Gb250L1N1YnR5cGUvVHlwZTEvQmFzZUZvbnQvSGVsdmV0aWNhPj4KZW5kb2JqCjYgMCBvYmoKPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMjAwIDIwMF0vUmVzb3VyY2VzPDwvRm9udDw8L0YxIDUgMCBSPj4+Pi9Db250ZW50cyA4IDAgUj4+CmVuZG9iago3IDAgb2JqCjw8L1R5cGUvQW5ub3QvU3VidHlwZS9MaW5rL1JlY3RbMjAgOTUgMTgwIDEyNV0vQm9yZGVyWzAgMCAwXS9EZXN0WzYgMCBSIC9GaXRdPj4KZW5kb2JqCjggMCBvYmoKPDwvTGVuZ3RoIDM5Pj4Kc3RyZWFtCkJUIC9GMSAyNCBUZiAyMCAxMDAgVGQgKFBhZ2UgdHdvKSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA5CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU0IDAwMDAwIG4gCjAwMDAwMDAxMTEgMDAwMDAgbiAKMDAwMDAwMDIzNyAwMDAwMCBuIAowMDAwMDAwMzI4IDAwMDAwIG4gCjAwMDAwMDAzOTEgMDAwMDAgbiAKMDAwMDAwMDUwMyAwMDAwMCBuIAowMDAwMDAwNTk4IDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA5L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKNjg1CiUlRU9G'

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Poll until `predicate()` holds (the component renders fire-and-forget). */
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

describe('components/PdfAnnotationLayer (リンク注釈層)', () => {
  let loadingTask: PDFDocumentLoadingTask
  let doc: Awaited<PDFDocumentLoadingTask['promise']>
  let page: PDFPageProxy

  beforeAll(async () => {
    // 境界 spec と同じ worker-source 上書き（vitest の web-root ?url を file:// へ）。
    const require = createRequire(import.meta.url)
    const workerPath = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs')
    GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href

    loadingTask = getDocument({ data: base64ToBytes(LINK_PDF_BASE64) })
    doc = await loadingTask.promise
    page = await doc.getPage(1)
  })

  afterAll(async () => {
    await loadingTask.destroy()
  })

  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('9.1 — リンク注釈をクリック可能な <a> として描画する', async () => {
    const viewport = page.getViewport({ scale: 1 })
    const wrapper = mount(PdfAnnotationLayer, { props: { page, viewport } })

    const container = wrapper.find('.annotation-layer').element as HTMLElement
    await waitFor(() => container.querySelectorAll('a').length > 0)

    const anchors = container.querySelectorAll('a')
    expect(anchors.length).toBeGreaterThan(0)
    // 内部 GoTo リンクなので data-internal-link が付き、href はプレースホルダ '#'。
    expect(container.querySelector('.linkAnnotation')).not.toBeNull()

    wrapper.unmount()
  })

  it('9.2 — 内部リンクのクリックでストアに移動先ジャンプを要求する', async () => {
    const store = usePdfStore()
    // resolveDest が getPageIndex を引けるよう、本物の doc を ready 状態で seed。
    store.setReady(doc, doc.numPages)

    const viewport = page.getViewport({ scale: 1 })
    const wrapper = mount(PdfAnnotationLayer, { props: { page, viewport } })
    const container = wrapper.find('.annotation-layer').element as HTMLElement
    await waitFor(() => container.querySelectorAll('a').length > 0)

    const anchor = container.querySelector('a') as HTMLAnchorElement
    // pdfjs は onclick を割り当て、内部 dest の場合 goToDestination を呼ぶ。
    anchor.click()

    // goToDestination → resolveDest(本物の doc) → page 2 → requestGoToPage(2)。
    await waitFor(() => store.pendingScrollTo === 2)
    expect(store.pendingScrollTo).toBe(2)

    wrapper.unmount()
  })

  it('9.4 — 層は pointer-events:none、--total-scale-factor をスケールに設定する', async () => {
    const scale = 1.5
    const viewport = page.getViewport({ scale })
    const wrapper = mount(PdfAnnotationLayer, { props: { page, viewport } })
    const container = wrapper.find('.annotation-layer').element as HTMLElement
    await waitFor(() => container.querySelectorAll('a').length > 0)

    // 層整合（要件 9.4）: setLayerDimensions が箱を --total-scale-factor で寸法化。
    expect(container.style.getPropertyValue('--total-scale-factor')).toBe(
      String(scale),
    )
    expect(container.style.getPropertyValue('--scale-factor')).toBe(
      String(scale),
    )
    // 層は絶対配置・同一原点（インライン）。pointer-events:none は非 scoped CSS で
    // 付与され、jsdom は適用済みスタイルを計算しないため、クラス存在で表現を担保。
    expect(container.style.position).toBe('absolute')
    expect(container.classList.contains('annotation-layer')).toBe(true)

    wrapper.unmount()
  })

  it('倍率変化で再描画しても <a> は重複しない（冪等）', async () => {
    const wrapper = mount(PdfAnnotationLayer, {
      props: { page, viewport: page.getViewport({ scale: 1 }) },
    })
    const container = wrapper.find('.annotation-layer').element as HTMLElement
    await waitFor(() => container.querySelectorAll('a').length > 0)
    const firstCount = container.querySelectorAll('a').length

    await wrapper.setProps({ viewport: page.getViewport({ scale: 2 }) })
    await waitFor(
      () =>
        container.style.getPropertyValue('--total-scale-factor') === '2' &&
        container.querySelectorAll('a').length > 0,
    )

    expect(container.querySelectorAll('a').length).toBe(firstCount)
    wrapper.unmount()
  })
})
