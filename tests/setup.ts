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
