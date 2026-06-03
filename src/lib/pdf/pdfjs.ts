/**
 * Single pdfjs access boundary (design.md "Boundary Commitments" / "Architecture").
 *
 * This is the ONLY module in the codebase allowed to import `pdfjs-dist`.
 * Composables (`usePdfDocument`, `usePdfPageRender`, ...), stores, the
 * coordinates lib and components MUST go through this module, never import
 * `pdfjs-dist` directly. Keeping the engine behind one boundary localizes the
 * blast radius of a pdfjs major upgrade (render / text-layer / worker API
 * changes) to `lib/pdf`.
 *
 * Worker configuration (steering tech.md "pdfjs ワーカー設定", requirement 1.5):
 * the worker is resolved from the *installed* `pdfjs-dist` via Vite's `?url`
 * import — never CDN-pinned — so the worker bundle is always version-matched to
 * the library (no "worker version mismatch") and all processing stays
 * client-side with no external network calls.
 */
import * as pdfjsLib from 'pdfjs-dist'
// `?url` makes Vite emit the worker as a fingerprinted asset and hand us its
// resolved URL. Version is intrinsically tied to the installed package.
import PdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorkerUrl

export { pdfjsLib }

// Minimal convenience re-exports for downstream composables. Anything not
// surfaced here can still be reached via the `pdfjsLib` namespace, keeping the
// public surface of the boundary small.
export const getDocument = pdfjsLib.getDocument
export const GlobalWorkerOptions = pdfjsLib.GlobalWorkerOptions
export const InvalidPDFException = pdfjsLib.InvalidPDFException
// Render-cancellation marker (display_utils). `usePdfPageRender` cancels the
// previous RenderTask on scale change; pdfjs rejects the cancelled task's
// promise with this exception, which is normal flow — not an error — and is
// swallowed. Surfacing it here lets the render composable detect it via
// `instanceof` (with a `.name` fallback) without importing pdfjs-dist directly.
export const RenderingCancelledException = pdfjsLib.RenderingCancelledException
// Selectable-text layer (display/text_layer). `usePdfTextLayer` builds the
// per-page text overlay via the v6 `TextLayer` *class* (`new TextLayer({...})`
// then `.render()`), not the removed `renderTextLayer()` helper. Surfacing it
// here keeps pdfjs-dist behind this single boundary (Req 2.3).
export const TextLayer = pdfjsLib.TextLayer
export const version = pdfjsLib.version

export type {
  PDFDocumentProxy,
  PDFPageProxy,
  PDFDocumentLoadingTask,
  PageViewport,
  RenderTask,
} from 'pdfjs-dist'
