// Ensure this file is treated as a module so the `declare global` augmentation
// below is valid (global augmentations must live in a module).
export {}

// TC39 Uint8Array hex method (proposal) is not yet in the TS lib defs; declare
// the slice the test environment shim provides so strict type-check passes.
declare global {
  interface Uint8Array {
    toHex?(): string
  }
}

// jsdom does not implement IntersectionObserver, which `usePageVirtualizer`
// uses to decide which pages are near-visible (Req 6.1/6.3/6.4). Provide a
// controllable, test-only stub: every constructed observer registers its
// callback and observed targets in a module-level registry so a test can fire
// synthetic `IntersectionObserverEntry`s and drive the composable's
// visible/active/release logic deterministically. Real browsers (and the Vite
// build target) provide the genuine API, so this is purely a test shim.
export interface IntersectionObserverStub {
  readonly callback: IntersectionObserverCallback
  readonly observed: Set<Element>
  readonly root: Element | Document | null
  readonly rootMargin: string
  readonly thresholds: ReadonlyArray<number>
}

const intersectionObserverRegistry: IntersectionObserverStub[] = []

/** Test helper: the most recently constructed IntersectionObserver stub. */
export function lastIntersectionObserver(): IntersectionObserverStub {
  const last = intersectionObserverRegistry.at(-1)
  if (last === undefined) {
    throw new Error('No IntersectionObserver has been constructed yet')
  }
  return last
}

/** Test helper: clear the IntersectionObserver registry between tests. */
export function resetIntersectionObservers(): void {
  intersectionObserverRegistry.length = 0
}

/**
 * Test helper: build a synthetic `IntersectionObserverEntry` for `target`.
 * Only the fields `usePageVirtualizer` reads are meaningful (`target`,
 * `isIntersecting`, `intersectionRatio`); the rest are filled with inert,
 * type-correct placeholders.
 */
export function makeIntersectionEntry(
  target: Element,
  isIntersecting: boolean,
  intersectionRatio: number,
): IntersectionObserverEntry {
  const rect: DOMRectReadOnly = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON() {
      return {}
    },
  }
  return {
    target,
    isIntersecting,
    intersectionRatio,
    boundingClientRect: rect,
    intersectionRect: rect,
    rootBounds: rect,
    time: 0,
  }
}

if (!('IntersectionObserver' in globalThis)) {
  class IntersectionObserverStubImpl implements IntersectionObserverStub {
    readonly callback: IntersectionObserverCallback
    readonly observed = new Set<Element>()
    readonly root: Element | Document | null
    readonly rootMargin: string
    readonly thresholds: ReadonlyArray<number>

    constructor(
      callback: IntersectionObserverCallback,
      options?: IntersectionObserverInit,
    ) {
      this.callback = callback
      this.root = (options?.root as Element | Document | null) ?? null
      this.rootMargin = options?.rootMargin ?? '0px'
      const t = options?.threshold ?? 0
      this.thresholds = Array.isArray(t) ? t : [t]
      intersectionObserverRegistry.push(this)
    }

    observe(target: Element): void {
      this.observed.add(target)
    }

    unobserve(target: Element): void {
      this.observed.delete(target)
    }

    disconnect(): void {
      this.observed.clear()
    }

    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  }

  ;(
    globalThis as unknown as { IntersectionObserver: unknown }
  ).IntersectionObserver = IntersectionObserverStubImpl
}

// jsdom does not implement ResizeObserver, which Vuetify's layout composables
// (used by <v-app>) require. Provide a no-op stub so chrome components mount in
// the test environment.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!('ResizeObserver' in globalThis)) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverStub
}

// jsdom does not implement the VisualViewport API (`window.visualViewport`),
// which Vuetify's VOverlay location strategy reads unconditionally to register
// resize/scroll listeners and compute the available viewport box. Because the
// bare `visualViewport` identifier is undeclared (not just undefined) in jsdom,
// Vuetify's `visualViewport?.addEventListener(...)` throws a ReferenceError
// rather than short-circuiting. Provide a minimal, inert VisualViewport stub so
// chrome components that use VOverlay (e.g. PdfDropZone's drag feedback) mount.
// Real browsers Vite targets provide the genuine API; this is purely a
// test-environment shim, mirroring the ResizeObserver stub above.
// TS's lib.dom already declares `visualViewport` on `Window`, so checking via
// `'visualViewport' in window` narrows the else-branch to `never`. Read the
// runtime value through an untyped view to detect jsdom's missing property.
if (
  typeof window !== 'undefined' &&
  (window as unknown as { visualViewport?: unknown }).visualViewport == null
) {
  const visualViewportStub = {
    offsetLeft: 0,
    offsetTop: 0,
    width: window.innerWidth,
    height: window.innerHeight,
    scale: 1,
    pageLeft: 0,
    pageTop: 0,
    addEventListener(): void {},
    removeEventListener(): void {},
    dispatchEvent(): boolean {
      return false
    },
  }
  Object.defineProperty(window, 'visualViewport', {
    value: visualViewportStub,
    configurable: true,
    writable: true,
  })
}

// jsdom's `HTMLCanvasElement.getContext('2d')` returns `null` because no
// canvas backend is installed. The pdfjs v6 *text layer* (`TextLayer`) is
// otherwise jsdom-compatible (text extraction + DOM <span> layout need no real
// rendering), but during layout it measures font ascent via a throwaway 2D
// context: `getCtx()` does `ctx.canvas`, `ctx.font = ...`, `ctx.measureText('')`
// reading `fontBoundingBox{Ascent,Descent}`. With a `null` context it crashes
// ("Invalid value used as weak map key"). Provide a minimal, measurement-only 2D
// context so the *real* TextLayer pipeline runs under jsdom and emits real
// selectable spans (the composable is exercised for real, not faked). Falls
// back to width=0 ascent metrics, which makes pdfjs use the per-style ascent —
// fine for asserting selectable text presence/alignment. Purely a
// test-environment shim; real browsers provide a true 2D context.
if (typeof HTMLCanvasElement !== 'undefined') {
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: (id: string) => unknown
  }
  const originalGetContext = proto.getContext
  proto.getContext = function patchedGetContext(
    this: HTMLCanvasElement,
    contextId: string,
  ): unknown {
    if (contextId === '2d') {
      const canvas = this
      const ctx = {
        canvas,
        font: '',
        measureText(): {
          width: number
          fontBoundingBoxAscent: number
          fontBoundingBoxDescent: number
        } {
          return {
            width: 0,
            fontBoundingBoxAscent: 0,
            fontBoundingBoxDescent: 0,
          }
        },
      }
      return ctx
    }
    return originalGetContext
      ? originalGetContext.call(this, contextId)
      : null
  }
}

// jsdom does not implement DOMMatrix, but `pdfjs-dist` evaluates
// `new DOMMatrix()` at module top level (display/canvas.js). Without this,
// importing the `src/lib/pdf/pdfjs.ts` boundary throws before any test runs.
// PDF parsing / numPages does not use the matrix (only rendering does), so a
// minimal identity-matrix stub is sufficient to load the module and exercise
// document-load behavior under jsdom. Rendering remains an E2E concern.
if (!('DOMMatrix' in globalThis)) {
  class DOMMatrixStub {
    a = 1
    b = 0
    c = 0
    d = 1
    e = 0
    f = 0
    constructor(_init?: unknown) {}
    multiply(): DOMMatrixStub {
      return this
    }
    translate(): DOMMatrixStub {
      return this
    }
    scale(): DOMMatrixStub {
      return this
    }
    inverse(): DOMMatrixStub {
      return this
    }
  }
  ;(globalThis as unknown as { DOMMatrix: unknown }).DOMMatrix = DOMMatrixStub
}

// `pdfjs-dist` v6 relies on the TC39 Uint8Array base64/hex methods
// (`Uint8Array.prototype.toHex`). Node 24 / jsdom do not ship them yet, so
// loading a document throws "a.toHex is not a function". Real browsers that
// Vite targets have these, so this is purely a test-environment shim.
if (typeof Uint8Array.prototype.toHex !== 'function') {
  Object.defineProperty(Uint8Array.prototype, 'toHex', {
    value(this: Uint8Array): string {
      let out = ''
      for (let i = 0; i < this.length; i += 1) {
        out += this[i].toString(16).padStart(2, '0')
      }
      return out
    },
    configurable: true,
    writable: true,
  })
}

// jsdom 25's `Blob`/`File` do not implement the `Blob.prototype.arrayBuffer()`
// method (nor `text()`/`stream()`), even though all browsers Vite targets do.
// `useFileIntake` reads dropped/selected files via the standard
// `file.arrayBuffer()` API, so provide a spec-faithful shim built on jsdom's
// `FileReader` (which it does implement). Purely a test-environment polyfill.
if (
  typeof Blob !== 'undefined' &&
  typeof Blob.prototype.arrayBuffer !== 'function'
) {
  Object.defineProperty(Blob.prototype, 'arrayBuffer', {
    value(this: Blob): Promise<ArrayBuffer> {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.onerror = () => reject(reader.error)
        reader.readAsArrayBuffer(this)
      })
    },
    configurable: true,
    writable: true,
  })
}
