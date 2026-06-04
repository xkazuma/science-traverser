import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { isReactive } from 'vue'

import {
  usePdfStore,
  SCALE_MIN,
  SCALE_MAX,
  SCALE_STEP,
} from '@/stores/pdfStore'
import type { PDFDocumentProxy } from '@/lib/pdf/pdfjs'
import type { PdfError } from '@/types/pdf'

/**
 * The store is pure state + actions (task 2.2); it never touches pdfjs. We
 * stand in a minimal fake `PDFDocumentProxy` so we can assert `setReady` holds
 * it by reference and keeps it non-reactive (`markRaw`, steering tech.md).
 */
function fakeDoc(numPages: number): PDFDocumentProxy {
  return { numPages } as unknown as PDFDocumentProxy
}

const SAMPLE_ERROR: PdfError = { kind: 'corrupt', message: 'broken' }

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('pdfStore — initial state', () => {
  it('starts in idle with empty slices', () => {
    const store = usePdfStore()
    expect(store.status).toBe('idle')
    expect(store.source).toBeNull()
    expect(store.doc).toBeNull()
    expect(store.numPages).toBe(0)
    expect(store.currentPage).toBe(1)
    expect(store.pendingScrollTo).toBeNull()
    expect(store.fitMode).toBe('none')
    expect(store.loadProgress).toBeNull()
    expect(store.error).toBeNull()
    // Reserved (phase-1 unused) slices initialized empty.
    expect(store.annotations).toEqual({})
    expect(store.layoutRegions).toEqual({})
    expect(store.layoutGraph).toBeNull()
  })

  it('initial scale is within the clamp bounds', () => {
    const store = usePdfStore()
    expect(store.scale).toBeGreaterThanOrEqual(SCALE_MIN)
    expect(store.scale).toBeLessThanOrEqual(SCALE_MAX)
  })
})

describe('pdfStore — status machine (idle→loading→ready|error, reset→idle)', () => {
  it('load() transitions to loading and resets error/progress', () => {
    const store = usePdfStore()
    store.setError(SAMPLE_ERROR)
    store.setProgress(0.5)

    const buf = new ArrayBuffer(8)
    store.load(buf)

    expect(store.status).toBe('loading')
    expect(store.source).toBe(buf)
    expect(store.error).toBeNull()
    expect(store.loadProgress).toBeNull()
  })

  it('setReady() stores doc (markRaw, same ref, non-reactive), numPages, ready, currentPage=1', () => {
    const store = usePdfStore()
    store.load(new ArrayBuffer(8))
    store.setCurrentPage(1) // ensure a known starting point

    const doc = fakeDoc(7)
    store.setReady(doc, 7)

    expect(store.status).toBe('ready')
    expect(store.numPages).toBe(7)
    expect(store.currentPage).toBe(1)
    // Same reference held.
    expect(store.doc).toBe(doc)
    // markRaw: the held doc must NOT be wrapped in a reactive proxy.
    expect(isReactive(store.doc)).toBe(false)
  })

  it('setError() transitions to error with the error set', () => {
    const store = usePdfStore()
    store.load(new ArrayBuffer(8))
    store.setError(SAMPLE_ERROR)

    expect(store.status).toBe('error')
    expect(store.error).toEqual(SAMPLE_ERROR)
  })

  it('reset() returns to idle initial state', () => {
    const store = usePdfStore()
    store.load(new ArrayBuffer(8))
    store.setReady(fakeDoc(5), 5)
    store.requestGoToPage(3)
    store.setCurrentPage(3)
    store.setProgress(0.9)

    store.reset()

    expect(store.status).toBe('idle')
    expect(store.source).toBeNull()
    expect(store.doc).toBeNull()
    expect(store.numPages).toBe(0)
    expect(store.currentPage).toBe(1)
    expect(store.pendingScrollTo).toBeNull()
    expect(store.loadProgress).toBeNull()
    expect(store.error).toBeNull()
  })

  it('setProgress() reflects load progress (and nullable)', () => {
    const store = usePdfStore()
    store.setProgress(0.42)
    expect(store.loadProgress).toBe(0.42)
    store.setProgress(null)
    expect(store.loadProgress).toBeNull()
  })
})

describe('pdfStore — currentPage / numPages (Requirement 3.1)', () => {
  it('exposes total pages and tracks scroll-follow currentPage in range', () => {
    const store = usePdfStore()
    store.setReady(fakeDoc(10), 10)
    expect(store.numPages).toBe(10)

    store.setCurrentPage(4)
    expect(store.currentPage).toBe(4)

    store.setCurrentPage(10)
    expect(store.currentPage).toBe(10)
  })

  it('setCurrentPage ignores out-of-range values (no change)', () => {
    const store = usePdfStore()
    store.setReady(fakeDoc(3), 3)
    store.setCurrentPage(2)

    store.setCurrentPage(0)
    expect(store.currentPage).toBe(2)
    store.setCurrentPage(4)
    expect(store.currentPage).toBe(2)
    store.setCurrentPage(-1)
    expect(store.currentPage).toBe(2)
  })
})

describe('pdfStore — requestGoToPage range (Requirement 3.5)', () => {
  it('in-range request sets pendingScrollTo', () => {
    const store = usePdfStore()
    store.setReady(fakeDoc(5), 5)

    store.requestGoToPage(3)
    expect(store.pendingScrollTo).toBe(3)
    store.requestGoToPage(1)
    expect(store.pendingScrollTo).toBe(1)
    store.requestGoToPage(5)
    expect(store.pendingScrollTo).toBe(5)
  })

  it('out-of-range request is IGNORED (pendingScrollTo unchanged)', () => {
    const store = usePdfStore()
    store.setReady(fakeDoc(5), 5)
    store.requestGoToPage(2)
    expect(store.pendingScrollTo).toBe(2)

    store.requestGoToPage(0)
    expect(store.pendingScrollTo).toBe(2)
    store.requestGoToPage(6)
    expect(store.pendingScrollTo).toBe(2)
    store.requestGoToPage(-3)
    expect(store.pendingScrollTo).toBe(2)
  })

  it('requestGoToPage does NOT move currentPage (jump request vs scroll result)', () => {
    const store = usePdfStore()
    store.setReady(fakeDoc(5), 5)
    store.setCurrentPage(2)

    store.requestGoToPage(4)
    expect(store.pendingScrollTo).toBe(4)
    expect(store.currentPage).toBe(2)
  })

  it('consumePendingScroll clears the pending jump', () => {
    const store = usePdfStore()
    store.setReady(fakeDoc(5), 5)
    store.requestGoToPage(4)
    expect(store.pendingScrollTo).toBe(4)

    store.consumePendingScroll()
    expect(store.pendingScrollTo).toBeNull()
  })
})

describe('pdfStore — zoom clamp (Requirement 4.2)', () => {
  it('zoomIn steps up and caps at SCALE_MAX', () => {
    const store = usePdfStore()
    const before = store.scale
    store.zoomIn()
    expect(store.scale).toBeGreaterThan(before)

    for (let i = 0; i < 50; i += 1) store.zoomIn()
    expect(store.scale).toBe(SCALE_MAX)
  })

  it('zoomOut steps down and floors at SCALE_MIN', () => {
    const store = usePdfStore()
    const before = store.scale
    store.zoomOut()
    expect(store.scale).toBeLessThan(before)

    for (let i = 0; i < 50; i += 1) store.zoomOut()
    expect(store.scale).toBe(SCALE_MIN)
  })

  it('zooming uses the discrete SCALE_STEP factor', () => {
    const store = usePdfStore()
    store.setScale(1)
    store.zoomIn()
    expect(store.scale).toBeCloseTo(1 * SCALE_STEP, 10)
    store.zoomOut()
    expect(store.scale).toBeCloseTo(1, 10)
  })

  it('zooming sets fitMode to none', () => {
    const store = usePdfStore()
    store.setFitMode('width')
    store.zoomIn()
    expect(store.fitMode).toBe('none')

    store.setFitMode('page')
    store.zoomOut()
    expect(store.fitMode).toBe('none')
  })

  it('setScale clamps beyond bounds', () => {
    const store = usePdfStore()
    store.setScale(100)
    expect(store.scale).toBe(SCALE_MAX)
    store.setScale(0.001)
    expect(store.scale).toBe(SCALE_MIN)
    store.setScale(1.5)
    expect(store.scale).toBe(1.5)
  })
})

describe('pdfStore — fitMode', () => {
  it('setFitMode updates the mode', () => {
    const store = usePdfStore()
    store.setFitMode('width')
    expect(store.fitMode).toBe('width')
    store.setFitMode('page')
    expect(store.fitMode).toBe('page')
    store.setFitMode('none')
    expect(store.fitMode).toBe('none')
  })
})
