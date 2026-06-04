import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ref } from 'vue'

import {
  usePageVirtualizer,
  type PageDimension,
} from '@/composables/usePageVirtualizer'
import {
  lastIntersectionObserver,
  makeIntersectionEntry,
  resetIntersectionObservers,
} from '../setup'

/**
 * Unit tests for the page-virtualization composable (Req 2.1 連続表示, 6.1
 * 近傍のみ描画, 6.2 全ページ分の領域事前確保, 6.3 新領域スクロールで描画, 6.4
 * 遠方ページ解放).
 *
 * The placeholder math is pure and exercised directly with `PageDimension`
 * data (no pdfjs). Visibility/active/release behavior is driven through the
 * controllable IntersectionObserver stub (tests/setup.ts): the composable
 * registers a callback we fire synthetic entries against.
 */

/** Build a PageDimension with a sane default rotation. */
function dim(
  pageNumber: number,
  widthPdf: number,
  heightPdf: number,
  rotation = 0,
): PageDimension {
  return { pageNumber, widthPdf, heightPdf, rotation }
}

/** A detached element standing in for a page DOM node. */
function pageEl(): HTMLElement {
  return document.createElement('div')
}

beforeEach(() => {
  resetIntersectionObservers()
})

afterEach(() => {
  resetIntersectionObservers()
})

describe('usePageVirtualizer — placeholder math (Req 6.2)', () => {
  it('computes per-page heights, cumulative offsets, and total height at scale 1', () => {
    const dims = [dim(1, 100, 200), dim(2, 100, 400), dim(3, 100, 200)]
    const { placeholders } = usePageVirtualizer(dims, 1, { gap: 10 })

    const ph = placeholders.value
    expect(ph).toHaveLength(3)

    // heights = heightPdf * scale
    expect(ph.map((p) => p.height)).toEqual([200, 400, 200])
    expect(ph.map((p) => p.width)).toEqual([100, 100, 100])

    // offsetTop = sum(prior heights) + sum(prior gaps)
    expect(ph.map((p) => p.offsetTop)).toEqual([0, 200 + 10, 600 + 20])

    // page numbers preserved
    expect(ph.map((p) => p.pageNumber)).toEqual([1, 2, 3])
  })

  it('doubles heights and offsets after recompute(2) (Req 6.2 / zoom)', () => {
    const dims = [dim(1, 100, 200), dim(2, 100, 400), dim(3, 100, 200)]
    const { placeholders, recompute } = usePageVirtualizer(dims, 1, { gap: 10 })

    recompute(2)
    const ph = placeholders.value

    expect(ph.map((p) => p.height)).toEqual([400, 800, 400])
    expect(ph.map((p) => p.width)).toEqual([200, 200, 200])
    // gaps are fixed layout px and are NOT scaled.
    expect(ph.map((p) => p.offsetTop)).toEqual([0, 400 + 10, 1200 + 20])
  })

  it('swaps width/height for 90/270 rotation', () => {
    const dims = [dim(1, 100, 200, 90), dim(2, 100, 200, 270), dim(3, 100, 200, 180)]
    const { placeholders } = usePageVirtualizer(dims, 1, { gap: 0 })
    const ph = placeholders.value

    // 90 and 270 swap → 200x100
    expect(ph[0]).toMatchObject({ width: 200, height: 100 })
    expect(ph[1]).toMatchObject({ width: 200, height: 100 })
    // 180 keeps orientation → 100x200
    expect(ph[2]).toMatchObject({ width: 100, height: 200 })

    // offsets follow the (rotated) heights: 0, 100, 200
    expect(ph.map((p) => p.offsetTop)).toEqual([0, 100, 200])
  })

  it('reacts to a reactive dimensions ref (recomputes placeholders)', () => {
    const dims = ref<PageDimension[]>([dim(1, 100, 200)])
    const { placeholders } = usePageVirtualizer(dims, 1, { gap: 10 })

    expect(placeholders.value).toHaveLength(1)

    dims.value = [dim(1, 100, 200), dim(2, 100, 300)]
    expect(placeholders.value).toHaveLength(2)
    expect(placeholders.value.map((p) => p.offsetTop)).toEqual([0, 210])
  })
})

describe('usePageVirtualizer — offsetOf jump targets (Req 3.4 / 5.2)', () => {
  it('returns the absolute offsetTop for an in-range page', () => {
    const dims = [dim(1, 100, 200), dim(2, 100, 400), dim(3, 100, 200)]
    const { offsetOf } = usePageVirtualizer(dims, 1, { gap: 10 })

    expect(offsetOf(1)).toBe(0)
    expect(offsetOf(2)).toBe(210)
    expect(offsetOf(3)).toBe(620)
  })

  it('clamps out-of-range page numbers to the nearest valid offset', () => {
    const dims = [dim(1, 100, 200), dim(2, 100, 400), dim(3, 100, 200)]
    const { offsetOf } = usePageVirtualizer(dims, 1, { gap: 10 })

    // below range → first page offset
    expect(offsetOf(0)).toBe(0)
    expect(offsetOf(-5)).toBe(0)
    // above range → last page offset
    expect(offsetOf(99)).toBe(620)
  })

  it('returns 0 when there are no pages', () => {
    const { offsetOf } = usePageVirtualizer([], 1)
    expect(offsetOf(1)).toBe(0)
  })

  it('reflects the new scale after recompute', () => {
    const dims = [dim(1, 100, 200), dim(2, 100, 400)]
    const { offsetOf, recompute } = usePageVirtualizer(dims, 1, { gap: 10 })
    expect(offsetOf(2)).toBe(210)
    recompute(2)
    expect(offsetOf(2)).toBe(410)
  })
})

describe('usePageVirtualizer — visibility & release (Req 6.1, 6.3, 6.4)', () => {
  function setup() {
    const dims = [
      dim(1, 100, 200),
      dim(2, 100, 200),
      dim(3, 100, 200),
      dim(4, 100, 200),
      dim(5, 100, 200),
    ]
    const v = usePageVirtualizer(dims, 1, { gap: 0, overscan: 1 })
    const els = new Map<number, HTMLElement>()
    for (let n = 1; n <= 5; n += 1) {
      const el = pageEl()
      els.set(n, el)
      v.observe(el, n)
    }
    return { v, els }
  }

  it('exposes only near (intersecting) pages in visiblePages and excludes far ones', () => {
    const { v, els } = setup()
    const observer = lastIntersectionObserver()

    // pages 2 and 3 enter the (margin-expanded) viewport
    observer.callback(
      [
        makeIntersectionEntry(els.get(2)!, true, 0.5),
        makeIntersectionEntry(els.get(3)!, true, 0.9),
      ],
      observer as unknown as IntersectionObserver,
    )

    const visible = v.visiblePages.value
    expect(visible).toContain(2)
    expect(visible).toContain(3)
    // far pages were never reported as intersecting
    expect(visible).not.toContain(1)
    expect(visible).not.toContain(5)
  })

  it('adds newly scrolled-in pages and drops scrolled-out ones (Req 6.3)', () => {
    const { v, els } = setup()
    const observer = lastIntersectionObserver()

    // initially 2,3 visible
    observer.callback(
      [
        makeIntersectionEntry(els.get(2)!, true, 0.5),
        makeIntersectionEntry(els.get(3)!, true, 0.9),
      ],
      observer as unknown as IntersectionObserver,
    )
    expect([...v.visiblePages.value].sort((a, b) => a - b)).toEqual([2, 3])

    // scroll down: 2 leaves, 4 enters
    observer.callback(
      [
        makeIntersectionEntry(els.get(2)!, false, 0),
        makeIntersectionEntry(els.get(4)!, true, 0.7),
      ],
      observer as unknown as IntersectionObserver,
    )
    expect([...v.visiblePages.value].sort((a, b) => a - b)).toEqual([3, 4])
  })

  it('releaseFar() identifies non-visible observed pages (Req 6.4)', () => {
    const { v, els } = setup()
    const observer = lastIntersectionObserver()

    observer.callback(
      [
        makeIntersectionEntry(els.get(3)!, true, 0.9),
        makeIntersectionEntry(els.get(4)!, true, 0.4),
      ],
      observer as unknown as IntersectionObserver,
    )

    const far = v.releaseFar()
    expect(far.sort((a, b) => a - b)).toEqual([1, 2, 5])
    // visible pages are not released
    expect(far).not.toContain(3)
    expect(far).not.toContain(4)
  })
})

describe('usePageVirtualizer — activePage tracking (Req 3.2)', () => {
  it('tracks the most-visible page as intersection ratios change', () => {
    const dims = [dim(1, 100, 200), dim(2, 100, 200), dim(3, 100, 200)]
    const v = usePageVirtualizer(dims, 1, { gap: 0, overscan: 1 })
    const els = new Map<number, HTMLElement>()
    for (let n = 1; n <= 3; n += 1) {
      const el = pageEl()
      els.set(n, el)
      v.observe(el, n)
    }
    const observer = lastIntersectionObserver()

    // page 2 is the most visible
    observer.callback(
      [
        makeIntersectionEntry(els.get(1)!, true, 0.2),
        makeIntersectionEntry(els.get(2)!, true, 0.8),
        makeIntersectionEntry(els.get(3)!, true, 0.1),
      ],
      observer as unknown as IntersectionObserver,
    )
    expect(v.activePage.value).toBe(2)

    // scroll so page 3 dominates
    observer.callback(
      [
        makeIntersectionEntry(els.get(2)!, true, 0.3),
        makeIntersectionEntry(els.get(3)!, true, 0.9),
      ],
      observer as unknown as IntersectionObserver,
    )
    expect(v.activePage.value).toBe(3)
  })

  it('defaults activePage to 1', () => {
    const v = usePageVirtualizer([dim(1, 100, 200)], 1)
    expect(v.activePage.value).toBe(1)
  })
})
