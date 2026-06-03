import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import PdfCanvasLayer from '@/components/PdfCanvasLayer.vue'
import type { UsePdfPageRender } from '@/composables/usePdfPageRender'
import type { PageViewport, PDFPageProxy } from '@/lib/pdf/pdfjs'

/**
 * フォーカス単体テスト: `PdfCanvasLayer` のオーケストレーション
 * （要件 2.2/2.4 — マウント時描画、scale 変化で再描画、アンマウントで cancel）。
 *
 * jsdom には真の 2D コンテキストがないため実ピクセルは出ない。タスク 3.1 と同様に
 * fake page を渡し、`usePdfPageRender` をモックして `render`/`cancel` の呼び出し
 * （配線）を検証する。本物のピクセル描画は E2E（タスク 6.1）の領分。
 */

const renderSpy = vi.fn<UsePdfPageRender['render']>(() => Promise.resolve())
const cancelSpy = vi.fn<UsePdfPageRender['cancel']>()

vi.mock('@/composables/usePdfPageRender', () => ({
  usePdfPageRender: (): UsePdfPageRender => ({
    render: renderSpy,
    cancel: cancelSpy,
  }),
}))

/** 最小限の fake page（getViewport だけ実装）。render は composable 側がモック。 */
function makeFakePage(): PDFPageProxy {
  return {
    getViewport: ({ scale }: { scale: number }): PageViewport =>
      ({ width: 100 * scale, height: 200 * scale, scale }) as unknown as PageViewport,
  } as unknown as PDFPageProxy
}

afterEach(() => {
  renderSpy.mockClear()
  cancelSpy.mockClear()
})

describe('components/PdfCanvasLayer', () => {
  it('canvas.canvas-layer を描画する', () => {
    const wrapper = mount(PdfCanvasLayer, {
      props: { page: makeFakePage(), scale: 1 },
    })
    const canvas = wrapper.find('canvas.canvas-layer')
    expect(canvas.exists()).toBe(true)
  })

  it('マウント時に render(canvas, page, scale) を呼ぶ', () => {
    const page = makeFakePage()
    const wrapper = mount(PdfCanvasLayer, { props: { page, scale: 1.5 } })

    expect(renderSpy).toHaveBeenCalledTimes(1)
    const [canvasArg, pageArg, scaleArg] = renderSpy.mock.calls[0]
    expect(canvasArg).toBe(wrapper.find('canvas.canvas-layer').element)
    // props は Vue のリアクティブプロキシで包まれるため、生の page と toBe では
    // 一致しない。getViewport 参照が同一であることで「同じページ」を確認する。
    expect(
      (pageArg as PDFPageProxy).getViewport,
    ).toBe(page.getViewport)
    expect(scaleArg).toBe(1.5)
  })

  it('scale 変化で再描画する（新 scale で render を再呼び出し）', async () => {
    const page = makeFakePage()
    const wrapper = mount(PdfCanvasLayer, { props: { page, scale: 1 } })
    expect(renderSpy).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ scale: 2 })
    expect(renderSpy).toHaveBeenCalledTimes(2)
    expect(renderSpy.mock.calls[1][2]).toBe(2)
  })

  it('page 変化で再描画する', async () => {
    const wrapper = mount(PdfCanvasLayer, { props: { page: makeFakePage(), scale: 1 } })
    expect(renderSpy).toHaveBeenCalledTimes(1)

    const nextPage = makeFakePage()
    await wrapper.setProps({ page: nextPage })
    expect(renderSpy).toHaveBeenCalledTimes(2)
    expect(
      (renderSpy.mock.calls[1][1] as PDFPageProxy).getViewport,
    ).toBe(nextPage.getViewport)
  })

  it('アンマウントで cancel() する', () => {
    const wrapper = mount(PdfCanvasLayer, { props: { page: makeFakePage(), scale: 1 } })
    expect(cancelSpy).not.toHaveBeenCalled()
    wrapper.unmount()
    expect(cancelSpy).toHaveBeenCalledTimes(1)
  })
})
