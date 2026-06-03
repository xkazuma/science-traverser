import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import App from '@/App.vue'
import { vuetify } from '@/plugins/vuetify'

describe('App (sanity)', () => {
  it('mounts and renders the placeholder heading', () => {
    const wrapper = mount(App, {
      global: { plugins: [vuetify] },
    })
    expect(wrapper.find('h1').exists()).toBe(true)
    expect(wrapper.find('h1').text()).toBe('PDF Viewer')
  })

  it('renders a Vuetify component (proves Vuetify chrome is wired)', () => {
    const wrapper = mount(App, {
      global: { plugins: [vuetify] },
    })
    // Vuetify must be registered via global.plugins (documented pattern /
    // steering convention) for chrome component tests.
    expect(wrapper.find('.v-btn').exists()).toBe(true)
  })

  it('renders an MDI icon inside the chrome (proves @mdi/font icon set)', () => {
    const wrapper = mount(App, {
      global: { plugins: [vuetify] },
    })
    // v-icon with the mdi default set emits an <i class="mdi mdi-...">.
    const icon = wrapper.find('i.mdi')
    expect(icon.exists()).toBe(true)
    expect(icon.classes()).toContain('mdi-file-pdf-box')
  })
})
