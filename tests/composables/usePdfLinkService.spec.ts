import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePdfLinkService } from '@/composables/usePdfLinkService'
import * as outlineModule from '@/composables/usePdfOutline'
import type { PDFDocumentProxy } from '@/lib/pdf/pdfjs'
import { usePdfStore } from '@/stores/pdfStore'

/**
 * Behavioral tests for the link-service composable (Req 9.2 内部リンクで移動先へ
 * ジャンプ / 9.3 外部 URL を新タブで開く).
 *
 * This is the navigation brain behind every clickable PDF link annotation:
 * pdfjs' `AnnotationLayer` calls `goToDestination` for internal cross-references
 * and `addLinkAttributes` for external URLs. We drive those methods directly and
 * assert the store jump request (`pendingScrollTo`, Req 9.2 → reuses 3.5 range
 * clamping) and the external-anchor attributes (Req 9.3).
 *
 * `resolveDest` (page-number resolution from a pdfjs dest) is owned by
 * `usePdfOutline` and tested there against a real PDF; here we stub it so the
 * navigation routing is tested in isolation, independent of dest parsing.
 */

/** A throwaway doc stand-in: the link service only checks it is non-null and
 *  hands it to `resolveDest`, which we stub — so the shape is irrelevant. */
function fakeDoc(): PDFDocumentProxy {
  return {} as unknown as PDFDocumentProxy
}

/** Seed a ready store with a doc and a page count so jumps are in-range. */
function seedReadyStore(numPages: number): ReturnType<typeof usePdfStore> {
  const store = usePdfStore()
  store.setReady(fakeDoc(), numPages)
  return store
}

describe('usePdfLinkService', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  describe('9.2 — 内部リンク（移動先指定）で移動先へジャンプ', () => {
    it('explicit-array dest を解決し requestGoToPage（pendingScrollTo）にセットする', async () => {
      const store = seedReadyStore(10)
      const resolveDest = vi.fn().mockResolvedValue(7)
      vi.spyOn(outlineModule, 'usePdfOutline').mockReturnValue({
        load: vi.fn(),
        resolveDest,
      })

      const service = usePdfLinkService()
      // 明示配列 dest（先頭が RefProxy 形）。resolveDest はスタブが page=7 を返す。
      const explicitDest = [{ num: 4, gen: 0 }, { name: 'XYZ' }, null, null, null]
      await service.goToDestination(explicitDest)

      expect(resolveDest).toHaveBeenCalledTimes(1)
      expect(resolveDest).toHaveBeenCalledWith(explicitDest, expect.anything())
      expect(store.pendingScrollTo).toBe(7)
    })

    it('named-string dest を解決し pendingScrollTo にセットする', async () => {
      const store = seedReadyStore(10)
      const resolveDest = vi.fn().mockResolvedValue(3)
      vi.spyOn(outlineModule, 'usePdfOutline').mockReturnValue({
        load: vi.fn(),
        resolveDest,
      })

      const service = usePdfLinkService()
      await service.goToDestination('section.intro')

      expect(resolveDest).toHaveBeenCalledWith('section.intro', expect.anything())
      expect(store.pendingScrollTo).toBe(3)
    })

    it('解決不能な dest（resolveDest→null）はナビゲーションしない', async () => {
      const store = seedReadyStore(10)
      vi.spyOn(outlineModule, 'usePdfOutline').mockReturnValue({
        load: vi.fn(),
        resolveDest: vi.fn().mockResolvedValue(null),
      })

      const service = usePdfLinkService()
      await service.goToDestination('missing')

      expect(store.pendingScrollTo).toBeNull()
    })

    it('範囲外ページ（resolveDest が numPages 超）は store がクランプして無視', async () => {
      const store = seedReadyStore(5)
      vi.spyOn(outlineModule, 'usePdfOutline').mockReturnValue({
        load: vi.fn(),
        resolveDest: vi.fn().mockResolvedValue(99),
      })

      const service = usePdfLinkService()
      await service.goToDestination([{ num: 1, gen: 0 }])

      expect(store.pendingScrollTo).toBeNull()
    })

    it('doc 未ロード時は resolveDest を呼ばずナビゲーションしない', async () => {
      const store = usePdfStore() // status idle, doc null
      const resolveDest = vi.fn()
      vi.spyOn(outlineModule, 'usePdfOutline').mockReturnValue({
        load: vi.fn(),
        resolveDest,
      })

      const service = usePdfLinkService()
      await service.goToDestination('whatever')

      expect(resolveDest).not.toHaveBeenCalled()
      expect(store.pendingScrollTo).toBeNull()
    })
  })

  describe('goToPage — 直接ページジャンプ', () => {
    it('範囲内ページを pendingScrollTo にセットする', () => {
      const store = seedReadyStore(10)
      const service = usePdfLinkService()

      service.goToPage(2)

      expect(store.pendingScrollTo).toBe(2)
    })

    it('範囲外ページは store がクランプして無視する', () => {
      const store = seedReadyStore(3)
      const service = usePdfLinkService()

      service.goToPage(0)
      expect(store.pendingScrollTo).toBeNull()
      service.goToPage(4)
      expect(store.pendingScrollTo).toBeNull()
    })
  })

  describe('9.3 — 外部 URL を新タブで開く', () => {
    it('addLinkAttributes が href / target=_blank / rel=noopener noreferrer を設定する', () => {
      const service = usePdfLinkService()
      const link = document.createElement('a')

      service.addLinkAttributes(link, 'https://example.com')

      expect(link.getAttribute('href')).toBe('https://example.com')
      expect(link.target).toBe('_blank')
      expect(link.rel).toBe('noopener noreferrer')
    })

    it('空 URL では新タブ属性を付けない', () => {
      const service = usePdfLinkService()
      const link = document.createElement('a')

      service.addLinkAttributes(link, '')

      expect(link.target).toBe('')
      expect(link.rel).toBe('')
    })
  })

  describe('executeNamedAction — ビューア名前付きアクション', () => {
    it('NextPage / PrevPage は現在ページ±1 を要求する', () => {
      const store = seedReadyStore(10)
      store.setCurrentPage(5)
      const service = usePdfLinkService()

      service.executeNamedAction('NextPage')
      expect(store.pendingScrollTo).toBe(6)

      store.consumePendingScroll()
      service.executeNamedAction('PrevPage')
      expect(store.pendingScrollTo).toBe(4)
    })

    it('FirstPage / LastPage は 1 / numPages を要求する', () => {
      const store = seedReadyStore(8)
      store.setCurrentPage(3)
      const service = usePdfLinkService()

      service.executeNamedAction('FirstPage')
      expect(store.pendingScrollTo).toBe(1)

      store.consumePendingScroll()
      service.executeNamedAction('LastPage')
      expect(store.pendingScrollTo).toBe(8)
    })

    it('未対応アクションは no-op（ナビゲーションしない）', () => {
      const store = seedReadyStore(8)
      store.setCurrentPage(3)
      const service = usePdfLinkService()

      service.executeNamedAction('GoBack')

      expect(store.pendingScrollTo).toBeNull()
    })
  })

  describe('補助メソッド / プロパティ', () => {
    it('getDestinationHash / getAnchorUrl は安全な値を返す', () => {
      const service = usePdfLinkService()
      expect(service.getDestinationHash('anything')).toBe('#')
      expect(service.getAnchorUrl('')).toBe('#')
      expect(service.getAnchorUrl('#frag')).toBe('#frag')
    })

    it('executeSetOCGState は no-op で throw しない', () => {
      const service = usePdfLinkService()
      expect(() => service.executeSetOCGState()).not.toThrow()
    })

    it('pagesCount / page getter はストアを反映する', () => {
      const store = seedReadyStore(12)
      store.setCurrentPage(4)
      const service = usePdfLinkService()

      expect(service.pagesCount).toBe(12)
      expect(service.page).toBe(4)
    })

    it('page setter は requestGoToPage を経由する', () => {
      const store = seedReadyStore(12)
      const service = usePdfLinkService()

      service.page = 9
      expect(store.pendingScrollTo).toBe(9)
    })
  })
})
