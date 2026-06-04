import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { VueWrapper } from '@vue/test-utils'
import { defineComponent, h, markRaw } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useZoomShortcuts } from '@/composables/useZoomShortcuts'
import type { PDFDocumentProxy } from '@/lib/pdf/pdfjs'
import { usePdfStore } from '@/stores/pdfStore'

/**
 * `useZoomShortcuts`（要件 4.6）の振る舞いテスト。
 *
 * ブラウザのズーム操作（Ctrl/Cmd +/-/0・Ctrl/Cmd+ホイール）を横取りし、ready の
 * ときのみ PDF ズームへ振り替えること、idle では介入しないこと、アンマウントで
 * リスナが解除されることを検証する。jsdom は KeyboardEvent/WheelEvent と
 * `defaultPrevented` を実装する。
 */

// status==='ready' と既知の scale だけが要件。pdfjs 実体は不要なので最小の偽 doc。
const fakeDoc = markRaw(
  {} as unknown as PDFDocumentProxy & { numPages: number },
)

/** useZoomShortcuts を呼ぶだけの極小ホスト。 */
const Host = defineComponent({
  name: 'ZoomShortcutsHost',
  setup() {
    useZoomShortcuts()
    return () => h('div')
  },
})

/**
 * マウントしたホストを追跡し、各テスト後に必ずアンマウントする。
 * window リスナを残すと後続テストの dispatch を横取りしてしまうため。
 */
const mountedHosts: VueWrapper[] = []

function mountHost(): VueWrapper {
  const wrapper = mount(Host)
  mountedHosts.push(wrapper)
  return wrapper
}

describe('composables/useZoomShortcuts（要件 4.6）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    while (mountedHosts.length > 0) {
      mountedHosts.pop()?.unmount()
    }
  })

  it('ready 時: Ctrl + "+" で zoomIn し preventDefault する', () => {
    const store = usePdfStore()
    store.setReady(fakeDoc, 3)
    const before = store.scale
    mountHost()

    const ev = new KeyboardEvent('keydown', {
      ctrlKey: true,
      key: '+',
      cancelable: true,
    })
    window.dispatchEvent(ev)

    expect(store.scale).toBeGreaterThan(before)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('ready 時: Ctrl + "-" で zoomOut する', () => {
    const store = usePdfStore()
    store.setReady(fakeDoc, 3)
    const before = store.scale
    mountHost()

    const ev = new KeyboardEvent('keydown', {
      ctrlKey: true,
      key: '-',
      cancelable: true,
    })
    window.dispatchEvent(ev)

    expect(store.scale).toBeLessThan(before)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('ready 時: Ctrl + "0" で等倍(scale=1, fitMode="none")に戻す', () => {
    const store = usePdfStore()
    store.setReady(fakeDoc, 3)
    store.zoomIn()
    store.setFitMode('width')
    mountHost()

    const ev = new KeyboardEvent('keydown', {
      ctrlKey: true,
      key: '0',
      cancelable: true,
    })
    window.dispatchEvent(ev)

    expect(store.scale).toBe(1)
    expect(store.fitMode).toBe('none')
    expect(ev.defaultPrevented).toBe(true)
  })

  it('ready 時: Meta + "=" でも zoomIn する（macOS の Cmd）', () => {
    const store = usePdfStore()
    store.setReady(fakeDoc, 3)
    const before = store.scale
    mountHost()

    const ev = new KeyboardEvent('keydown', {
      metaKey: true,
      key: '=',
      cancelable: true,
    })
    window.dispatchEvent(ev)

    expect(store.scale).toBeGreaterThan(before)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('ready 時: Ctrl+ホイール上方向で zoomIn・下方向で zoomOut し preventDefault', () => {
    const store = usePdfStore()
    store.setReady(fakeDoc, 3)
    mountHost()

    const baseline = store.scale
    const up = new WheelEvent('wheel', {
      ctrlKey: true,
      deltaY: -1,
      cancelable: true,
    })
    window.dispatchEvent(up)
    expect(store.scale).toBeGreaterThan(baseline)
    expect(up.defaultPrevented).toBe(true)

    const afterUp = store.scale
    const down = new WheelEvent('wheel', {
      ctrlKey: true,
      deltaY: 1,
      cancelable: true,
    })
    window.dispatchEvent(down)
    expect(store.scale).toBeLessThan(afterUp)
    expect(down.defaultPrevented).toBe(true)
  })

  it('idle 時: Ctrl + "+" は scale を変えず preventDefault もしない', () => {
    const store = usePdfStore()
    expect(store.status).toBe('idle')
    const before = store.scale
    mountHost()

    const ev = new KeyboardEvent('keydown', {
      ctrlKey: true,
      key: '+',
      cancelable: true,
    })
    window.dispatchEvent(ev)

    expect(store.scale).toBe(before)
    expect(ev.defaultPrevented).toBe(false)
  })

  it('修飾キー無しの "+" は無視する（介入しない）', () => {
    const store = usePdfStore()
    store.setReady(fakeDoc, 3)
    const before = store.scale
    mountHost()

    const ev = new KeyboardEvent('keydown', { key: '+', cancelable: true })
    window.dispatchEvent(ev)

    expect(store.scale).toBe(before)
    expect(ev.defaultPrevented).toBe(false)
  })

  it('アンマウント後はリスナが解除され反応しない', () => {
    const store = usePdfStore()
    store.setReady(fakeDoc, 3)
    const wrapper = mountHost()
    wrapper.unmount()

    const before = store.scale
    const ev = new KeyboardEvent('keydown', {
      ctrlKey: true,
      key: '+',
      cancelable: true,
    })
    window.dispatchEvent(ev)

    expect(store.scale).toBe(before)
    expect(ev.defaultPrevented).toBe(false)
  })
})
