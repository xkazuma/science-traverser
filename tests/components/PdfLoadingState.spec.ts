import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import PdfLoadingState from '@/components/PdfLoadingState.vue'
import { usePdfStore } from '@/stores/pdfStore'
import { vuetify } from '@/plugins/vuetify'

/**
 * クローム部品 `PdfLoadingState` の表示テスト（design.md「UI → PdfLoadingState /
 * PdfErrorState」/ 要件 7.1, 7.2）。
 *
 * PdfLoadingState は Vuetify 部品のみで構成し、store を**読み取るだけ**で
 * 読み込みのトリガはしない。`status === 'loading'` のときだけ表示し、進捗が
 * 取得できれば確定プログレス、できなければ不確定スピナーを出す。
 *
 * マウントは PdfToolbar.spec.ts のパターンに従い vuetify プラグインを登録し、
 * 加えて Pinia を有効化する。安定取得のため data-test 属性を用いる。
 */

/** 指定した store 状態で PdfLoadingState をマウントする。 */
function mountLoading(
  seed: (store: ReturnType<typeof usePdfStore>) => void,
): { wrapper: VueWrapper; store: ReturnType<typeof usePdfStore> } {
  const store = usePdfStore()
  seed(store)
  const wrapper = mount(PdfLoadingState, {
    global: { plugins: [vuetify] },
  })
  return { wrapper, store }
}

describe('components/PdfLoadingState（クローム・ローディング）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('7.1: loading かつ進捗 null なら不確定スピナーと「読み込み中」を表示', () => {
    const { wrapper } = mountLoading((s) => {
      s.status = 'loading'
      s.loadProgress = null
    })
    const root = wrapper.find('[data-test="loading-state"]')
    expect(root.exists()).toBe(true)
    // 不確定スピナー（VProgressCircular indeterminate）が出る。
    const spinner = wrapper.find('[data-test="loading-spinner"]')
    expect(spinner.exists()).toBe(true)
    // 確定プログレスバーは出ない。
    expect(wrapper.find('[data-test="loading-progress"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('読み込み中')
  })

  it('7.2: loading かつ進捗 0.42 なら確定プログレス（約42%）を表示', () => {
    const { wrapper } = mountLoading((s) => {
      s.status = 'loading'
      s.loadProgress = 0.42
    })
    const progress = wrapper.find('[data-test="loading-progress"]')
    expect(progress.exists()).toBe(true)
    // VProgressLinear は model-value をパーセント（0..100）でレンダリングする。
    // aria-valuenow / style 幅のいずれかに 42 が反映される。
    const valuenow = progress.attributes('aria-valuenow')
    expect(valuenow).toBe('42')
    // 不確定スピナーは出ない。
    expect(wrapper.find('[data-test="loading-spinner"]').exists()).toBe(false)
    // パーセント表記を併記する。
    expect(wrapper.text()).toContain('42')
  })

  it('loading でないとき（ready）は何も表示しない', () => {
    const { wrapper } = mountLoading((s) => {
      s.status = 'ready'
      s.loadProgress = null
    })
    expect(wrapper.find('[data-test="loading-state"]').exists()).toBe(false)
  })

  it('loading でないとき（idle）は何も表示しない', () => {
    const { wrapper } = mountLoading((s) => {
      s.status = 'idle'
    })
    expect(wrapper.find('[data-test="loading-state"]').exists()).toBe(false)
  })
})
