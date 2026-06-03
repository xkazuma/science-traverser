import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import App from '@/App.vue'

describe('App (sanity)', () => {
  it('mounts and renders the placeholder heading', () => {
    const wrapper = mount(App)
    expect(wrapper.find('h1').exists()).toBe(true)
    expect(wrapper.find('h1').text()).toBe('PDF Viewer')
  })
})
