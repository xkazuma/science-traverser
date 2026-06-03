import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PdfToolbar from '@/components/PdfToolbar.vue'
import {
  SCALE_MAX,
  SCALE_MIN,
  usePdfStore,
} from '@/stores/pdfStore'
import { vuetify } from '@/plugins/vuetify'

/**
 * クローム部品 `PdfToolbar` の操作テスト（design.md「UI → その他 UI → PdfToolbar」/
 * 要件 3.1, 3.3, 3.4, 4.1, 4.3, 4.4）。
 *
 * PdfToolbar は Vuetify 部品で構成され、操作は store action / emit のみ（ロジックを
 * 持たない）。フィットの実描画倍率算出は task 5.2 が担うため、本テストは「フィット
 * モードが選択されたら store.setFitMode が呼ばれ fitMode が変わる」までを検証する。
 *
 * マウントは sanity.spec.ts のパターンに従い vuetify プラグインを登録し、加えて
 * Pinia を有効化する。ボタンは data-test 属性で安定取得する。
 */

/** ready 状態の典型シードでツールバーをマウントする。 */
function mountToolbar(
  overrides: Partial<{
    numPages: number
    currentPage: number
    scale: number
  }> = {},
): { wrapper: VueWrapper; store: ReturnType<typeof usePdfStore> } {
  const store = usePdfStore()
  store.numPages = overrides.numPages ?? 5
  store.currentPage = overrides.currentPage ?? 2
  store.scale = overrides.scale ?? 1
  store.status = 'ready'
  const wrapper = mount(PdfToolbar, {
    global: { plugins: [vuetify] },
  })
  return { wrapper, store }
}

describe('components/PdfToolbar（クローム・ツールバー）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('3.1: 現在ページと総数を表示する', () => {
    const { wrapper } = mountToolbar({ currentPage: 2, numPages: 5 })
    // 現在ページはジャンプ入力欄に反映される。
    const input = wrapper.find('[data-test="page-jump"] input')
    expect((input.element as HTMLInputElement).value).toBe('2')
    // 総数は "/ 5" 形式で表示される。
    expect(wrapper.find('[data-test="page-total"]').text()).toMatch(/\/\s*5/)
  })

  it('3.3: Next クリックで requestGoToPage(currentPage+1)', async () => {
    const { wrapper, store } = mountToolbar({ currentPage: 2, numPages: 5 })
    const spy = vi.spyOn(store, 'requestGoToPage')
    await wrapper.find('[data-test="next-page"]').trigger('click')
    expect(spy).toHaveBeenCalledWith(3)
  })

  it('3.3: Prev クリックで requestGoToPage(currentPage-1)', async () => {
    const { wrapper, store } = mountToolbar({ currentPage: 2, numPages: 5 })
    const spy = vi.spyOn(store, 'requestGoToPage')
    await wrapper.find('[data-test="prev-page"]').trigger('click')
    expect(spy).toHaveBeenCalledWith(1)
  })

  it('3.3: 先頭ページでは Prev が無効', () => {
    const { wrapper } = mountToolbar({ currentPage: 1, numPages: 5 })
    const prev = wrapper.find('[data-test="prev-page"]')
    expect(prev.attributes('disabled')).toBeDefined()
  })

  it('3.3: 末尾ページでは Next が無効', () => {
    const { wrapper } = mountToolbar({ currentPage: 5, numPages: 5 })
    const next = wrapper.find('[data-test="next-page"]')
    expect(next.attributes('disabled')).toBeDefined()
  })

  it('3.4: ジャンプ入力の確定で requestGoToPage(その番号)', async () => {
    const { wrapper, store } = mountToolbar({ currentPage: 2, numPages: 5 })
    const spy = vi.spyOn(store, 'requestGoToPage')
    const input = wrapper.find('[data-test="page-jump"] input')
    await input.setValue('4')
    await input.trigger('keydown.enter')
    expect(spy).toHaveBeenCalledWith(4)
  })

  it('3.4: 範囲外入力は store が無視し、blur で表示が現在ページへ戻る', async () => {
    const { wrapper, store } = mountToolbar({ currentPage: 2, numPages: 5 })
    const input = wrapper.find('[data-test="page-jump"] input')
    await input.setValue('99')
    await input.trigger('blur')
    // store は範囲外を無視（currentPage は変わらない）。
    expect(store.currentPage).toBe(2)
    // 入力欄は現在ページへリセットされる。
    expect((input.element as HTMLInputElement).value).toBe('2')
  })

  it('4.1: zoom-in クリックで scale が増加（zoomIn）', async () => {
    const { wrapper, store } = mountToolbar({ scale: 1 })
    await wrapper.find('[data-test="zoom-in"]').trigger('click')
    expect(store.scale).toBeGreaterThan(1)
  })

  it('4.1: zoom-out クリックで scale が減少（zoomOut）', async () => {
    const { wrapper, store } = mountToolbar({ scale: 1 })
    await wrapper.find('[data-test="zoom-out"]').trigger('click')
    expect(store.scale).toBeLessThan(1)
  })

  it('4.1: 上限では zoom-in が無効', () => {
    const { wrapper } = mountToolbar({ scale: SCALE_MAX })
    expect(
      wrapper.find('[data-test="zoom-in"]').attributes('disabled'),
    ).toBeDefined()
  })

  it('4.1: 下限では zoom-out が無効', () => {
    const { wrapper } = mountToolbar({ scale: SCALE_MIN })
    expect(
      wrapper.find('[data-test="zoom-out"]').attributes('disabled'),
    ).toBeDefined()
  })

  it('4.3: fit-width クリックで fitMode が "width"', async () => {
    const { wrapper, store } = mountToolbar()
    await wrapper.find('[data-test="fit-width"]').trigger('click')
    expect(store.fitMode).toBe('width')
  })

  it('4.4: fit-page クリックで fitMode が "page"', async () => {
    const { wrapper, store } = mountToolbar()
    await wrapper.find('[data-test="fit-page"]').trigger('click')
    expect(store.fitMode).toBe('page')
  })

  it('Open ボタンクリックで "open" を emit する', async () => {
    const { wrapper } = mountToolbar()
    await wrapper.find('[data-test="open"]').trigger('click')
    expect(wrapper.emitted('open')).toBeTruthy()
    expect(wrapper.emitted('open')).toHaveLength(1)
  })

  it('未読込（status!=ready）ではページ/ズーム/フィット操作が無効、Open は有効', () => {
    const store = usePdfStore()
    store.status = 'idle'
    store.numPages = 0
    store.currentPage = 1
    const wrapper = mount(PdfToolbar, { global: { plugins: [vuetify] } })
    expect(
      wrapper.find('[data-test="next-page"]').attributes('disabled'),
    ).toBeDefined()
    expect(
      wrapper.find('[data-test="zoom-in"]').attributes('disabled'),
    ).toBeDefined()
    expect(
      wrapper.find('[data-test="fit-width"]').attributes('disabled'),
    ).toBeDefined()
    expect(
      wrapper.find('[data-test="open"]').attributes('disabled'),
    ).toBeUndefined()
  })
})
