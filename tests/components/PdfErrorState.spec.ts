import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import PdfErrorState from '@/components/PdfErrorState.vue'
import { usePdfStore } from '@/stores/pdfStore'
import type { PdfErrorKind } from '@/types/pdf'
import { vuetify } from '@/plugins/vuetify'

/**
 * クローム部品 `PdfErrorState` の表示テスト（design.md「UI → PdfErrorState」/
 * 「Error Handling → Error Categories and Responses」/ 要件 7.3, 7.4, 7.5）。
 *
 * PdfErrorState は store を**読み取るだけ**で、二つの責務を持つ:
 * - `status === 'idle'`（エラーなし）: 初期案内（ファイルを開くよう促す）（7.5）。
 * - `status === 'error'`: `error.kind` に応じた利用者向けメッセージ（7.3, 7.4 ほか）。
 *
 * マウントは PdfToolbar.spec.ts のパターンに従い vuetify プラグインを登録し、
 * 加えて Pinia を有効化する。安定取得のため data-test 属性を用いる。
 */

/** 指定した store 状態で PdfErrorState をマウントする。 */
function mountError(
  seed: (store: ReturnType<typeof usePdfStore>) => void,
): { wrapper: VueWrapper; store: ReturnType<typeof usePdfStore> } {
  const store = usePdfStore()
  seed(store)
  const wrapper = mount(PdfErrorState, {
    global: { plugins: [vuetify] },
  })
  return { wrapper, store }
}

/** エラー状態をシードするヘルパ。 */
function seedError(kind: PdfErrorKind) {
  return (s: ReturnType<typeof usePdfStore>): void => {
    s.status = 'error'
    s.error = { kind, message: `raw:${kind}` }
  }
}

describe('components/PdfErrorState（クローム・エラー/初期案内）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('7.5: idle のときファイルを開くよう促す初期案内を表示', () => {
    const { wrapper } = mountError((s) => {
      s.status = 'idle'
      s.error = null
    })
    const idle = wrapper.find('[data-test="idle-prompt"]')
    expect(idle.exists()).toBe(true)
    expect(idle.text()).toContain('PDF')
    expect(idle.text()).toMatch(/開いて/)
    // エラー表示は出ない。
    expect(wrapper.find('[data-test="error-alert"]').exists()).toBe(false)
  })

  it('7.5: ready のとき初期案内は表示しない', () => {
    const { wrapper } = mountError((s) => {
      s.status = 'ready'
      s.error = null
    })
    expect(wrapper.find('[data-test="idle-prompt"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="error-alert"]').exists()).toBe(false)
  })

  it('loading のときは何も表示しない（ローディングは別部品）', () => {
    const { wrapper } = mountError((s) => {
      s.status = 'loading'
      s.error = null
    })
    expect(wrapper.find('[data-test="idle-prompt"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="error-alert"]').exists()).toBe(false)
  })

  it('7.3: corrupt は破損して読み込めない旨を表示', () => {
    const { wrapper } = mountError(seedError('corrupt'))
    const alert = wrapper.find('[data-test="error-alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toMatch(/破損/)
    // エラー種の Vuetify type=error である。
    expect(alert.classes().some((c) => c.includes('error'))).toBe(true)
  })

  it('7.4: password はパスワード保護されている旨を表示', () => {
    const { wrapper } = mountError(seedError('password'))
    const alert = wrapper.find('[data-test="error-alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toMatch(/パスワード/)
  })

  it('invalid-type は PDF 形式でない旨を表示', () => {
    const { wrapper } = mountError(seedError('invalid-type'))
    const alert = wrapper.find('[data-test="error-alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toMatch(/PDF/)
    expect(alert.text()).toMatch(/形式/)
  })

  it('unknown は一般的なエラーメッセージを表示', () => {
    const { wrapper } = mountError(seedError('unknown'))
    const alert = wrapper.find('[data-test="error-alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text().length).toBeGreaterThan(0)
    expect(alert.text()).toMatch(/エラー|失敗|読み込め/)
  })

  it('error だが error が null のときも一般メッセージにフォールバック', () => {
    const { wrapper } = mountError((s) => {
      s.status = 'error'
      s.error = null
    })
    const alert = wrapper.find('[data-test="error-alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text().length).toBeGreaterThan(0)
  })
})
