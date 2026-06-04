import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PdfDropZone from '@/components/PdfDropZone.vue'
import { usePdfStore } from '@/stores/pdfStore'
import { vuetify } from '@/plugins/vuetify'

/**
 * クローム部品 `PdfDropZone` の D&D テスト（design.md「UI → PdfDropZone」/
 * 要件 1.2 ドロップで読み込み開始 / 1.3 ドラッグ中の視覚FB）。
 *
 * PdfDropZone は全面ドロップ領域で、ドラッグ中は Vuetify `VOverlay` による視覚FBを
 * 出す。受け入れは `useFileIntake().fromDrop(event)` 経由（pdfjs は直接呼ばない）。
 * ドロップ成功時は `file` イベントに `ArrayBuffer` を載せて emit し、ビューア結線
 * （task 5.1）が読み込みへ渡す（DropZone は pdfjs と疎結合）。非PDFは store.setError。
 *
 * マウントは他のクローム部品テストに倣い vuetify プラグイン + Pinia を登録する。
 * jsdom は `DataTransfer` を実装しないため、ドラッグ/ドロップは**実 DOM イベント**を
 * 生成し `dataTransfer` を差し込んで `dispatchEvent` する。`preventDefault` は
 * 実イベントの `defaultPrevented` で確認する（`@vue/test-utils` の `trigger` は
 * カスタム `preventDefault` を載せ替えないため、実イベントの方が信頼できる）。
 * VOverlay は表示時に root へ `.v-overlay--active` を付与し、非表示時は外す
 * （内容ノードは DOM に残るため、`exists()` ではなく active クラスで可視判定する）。
 */

/** 既定スロット込みで PdfDropZone をマウントするヘルパ。 */
function mountDropZone(): {
  wrapper: VueWrapper
  store: ReturnType<typeof usePdfStore>
} {
  const store = usePdfStore()
  const wrapper = mount(PdfDropZone, {
    global: { plugins: [vuetify] },
    // 全面ラッパは既定スロットでアプリ内容を内包する。
    slots: { default: '<p data-test="child">app content</p>' },
    attachTo: document.body,
  })
  return { wrapper, store }
}

/** 全面ドロップ領域の実 DOM 要素。 */
function zoneEl(wrapper: VueWrapper): HTMLElement {
  return wrapper.find('[data-test="dropzone"]').element as HTMLElement
}

/**
 * 実 DOM のドラッグ/ドロップイベントを生成して dispatch する。jsdom には
 * `DataTransfer` が無いため、必要最小限の `{ files }` スタブを読取専用で差し込む。
 * dispatch 後のイベントを返し、`defaultPrevented` を検証できるようにする。
 */
function dispatchDrag(
  el: HTMLElement,
  type: 'dragenter' | 'dragover' | 'dragleave' | 'drop',
  files: File[] = [],
): DragEvent {
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
  }) as DragEvent
  Object.defineProperty(event, 'dataTransfer', {
    value: { files },
    configurable: true,
  })
  el.dispatchEvent(event)
  return event
}

/** 視覚FB（VOverlay）が可視か = overlay root に `--active` が付いているか。 */
function feedbackVisible(wrapper: VueWrapper): boolean {
  const overlay = wrapper.find('.v-overlay')
  return overlay.exists() && overlay.classes().includes('v-overlay--active')
}

describe('components/PdfDropZone（クローム・全面D&D）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('既定スロットの内容を内包する（全面ラッパ）', () => {
    const { wrapper } = mountDropZone()
    expect(wrapper.find('[data-test="dropzone"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="child"]').text()).toBe('app content')
    wrapper.unmount()
  })

  it('1.3: ドラッグ中は視覚FB（オーバーレイ）を表示し、離脱で隠す', async () => {
    const { wrapper } = mountDropZone()
    const el = zoneEl(wrapper)
    expect(feedbackVisible(wrapper)).toBe(false)

    dispatchDrag(el, 'dragenter')
    await wrapper.vm.$nextTick()
    expect(feedbackVisible(wrapper)).toBe(true)

    dispatchDrag(el, 'dragleave')
    await wrapper.vm.$nextTick()
    expect(feedbackVisible(wrapper)).toBe(false)
    wrapper.unmount()
  })

  it('1.3: ドラッグFBには「ドロップ」を促す案内とアイコンが出る', async () => {
    const { wrapper } = mountDropZone()
    dispatchDrag(zoneEl(wrapper), 'dragenter')
    await wrapper.vm.$nextTick()

    const fb = wrapper.find('[data-test="drag-feedback"]')
    expect(fb.exists()).toBe(true)
    expect(fb.text()).toMatch(/ドロップ/)
    expect(fb.text()).toMatch(/PDF/)
    // 視覚的手掛かりとしてアイコンを伴う。
    expect(fb.find('.v-icon').exists()).toBe(true)
    wrapper.unmount()
  })

  it('dragover は preventDefault を呼びドロップを許可する', async () => {
    const { wrapper } = mountDropZone()
    const event = dispatchDrag(zoneEl(wrapper), 'dragover')
    expect(event.defaultPrevented).toBe(true)
    wrapper.unmount()
  })

  it('子要素間の en/leave フリッカでFBが消えない（カウンタ方式）', async () => {
    const { wrapper } = mountDropZone()
    const el = zoneEl(wrapper)
    // 親 enter → 子 enter（=2回目 enter）→ 子 leave（1回目 leave）でも維持。
    dispatchDrag(el, 'dragenter')
    dispatchDrag(el, 'dragenter')
    dispatchDrag(el, 'dragleave')
    await wrapper.vm.$nextTick()
    expect(feedbackVisible(wrapper)).toBe(true)
    // 対応する2回目の leave で初めて消える。
    dispatchDrag(el, 'dragleave')
    await wrapper.vm.$nextTick()
    expect(feedbackVisible(wrapper)).toBe(false)
    wrapper.unmount()
  })

  it('1.2: PDF をドロップすると ArrayBuffer を file イベントで emit する', async () => {
    const { wrapper } = mountDropZone()
    const el = zoneEl(wrapper)
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]) // "%PDF"
    const file = new File([bytes], 'a.pdf', { type: 'application/pdf' })

    dispatchDrag(el, 'dragenter', [file])
    await wrapper.vm.$nextTick()
    expect(feedbackVisible(wrapper)).toBe(true)

    const dropEvent = dispatchDrag(el, 'drop', [file])
    await wrapper.vm.$nextTick()

    // ドロップで preventDefault（ブラウザの遷移防止）。
    expect(dropEvent.defaultPrevented).toBe(true)
    // ドロップ後は視覚FBを隠す。
    expect(feedbackVisible(wrapper)).toBe(false)

    // fromDrop は非同期（file.arrayBuffer）なので解決を待つ。
    await vi.waitFor(() => {
      expect(wrapper.emitted('file')).toBeTruthy()
    })
    const emitted = wrapper.emitted('file')
    expect(emitted).toHaveLength(1)
    const buffer = emitted?.[0]?.[0]
    expect(buffer).toBeInstanceOf(ArrayBuffer)
    expect(Array.from(new Uint8Array(buffer as ArrayBuffer))).toEqual([
      0x25, 0x50, 0x44, 0x46,
    ])
    wrapper.unmount()
  })

  it('1.4近傍: 非PDF をドロップすると emit せず store.setError(invalid-type)', async () => {
    const { wrapper, store } = mountDropZone()
    const file = new File([new Uint8Array([1, 2, 3])], 'note.txt', {
      type: 'text/plain',
    })

    const dropEvent = dispatchDrag(zoneEl(wrapper), 'drop', [file])
    expect(dropEvent.defaultPrevented).toBe(true)

    await vi.waitFor(() => {
      expect(store.status).toBe('error')
    })
    expect(store.error?.kind).toBe('invalid-type')
    expect(store.error?.message).toMatch(/PDF/)
    // ファイルは読み込まない（emit されない）。
    expect(wrapper.emitted('file')).toBeFalsy()
    wrapper.unmount()
  })
})
