import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import { vuetify } from '@/plugins/vuetify'

/**
 * ルートシェル `App.vue` のサニティ。task 5.1 で App は demo ボタンを廃し
 * `<v-app><PdfViewer /></v-app>` を載せるよう変更されたため、本テストも
 * 「PdfViewer が <v-app> 配下に載っており、初期 idle 案内が出る」ことを確認する
 * （旧 demo ボタン/見出しではなく新しいルート構成を検証する）。
 */
describe('App (sanity)', () => {
  it('mounts PdfViewer under the Vuetify <v-app> chrome', () => {
    setActivePinia(createPinia())
    const wrapper = mount(App, {
      global: { plugins: [vuetify] },
    })
    // Vuetify chrome is wired (<v-app> renders the application root).
    expect(wrapper.find('.v-application').exists()).toBe(true)
    // The orchestrator is hosted under the chrome.
    expect(wrapper.findComponent({ name: 'PdfViewer' }).exists()).toBe(true)
  })

  it('shows the initial "open a PDF" prompt on a fresh (idle) store (Req 7.5)', () => {
    setActivePinia(createPinia())
    const wrapper = mount(App, {
      global: { plugins: [vuetify] },
    })
    expect(wrapper.find('[data-test="idle-prompt"]').exists()).toBe(true)
  })
})
