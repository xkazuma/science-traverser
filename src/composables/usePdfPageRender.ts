/**
 * Page-render composable (design.md "Composables → usePdfPageRender", Req 2.2,
 * 4.1).
 *
 * Renders a single `PDFPageProxy` into a `<canvas>` crisply on HiDPI displays
 * and keeps re-renders cheap during continuous zoom by cancelling the previous
 * in-flight render before starting a new one.
 *
 * Boundary commitment (design.md "Boundary Commitments"): pdfjs is reached ONLY
 * through `@/lib/pdf/pdfjs` — never `pdfjs-dist` directly.
 *
 * DPR strategy (Req 2.2): the canvas backing store is sized to
 * `viewport.{width,height} × devicePixelRatio` while the CSS box stays at the
 * viewport (= CSS-pixel) dimensions, so each CSS pixel maps to `dpr` device
 * pixels and the page is sharp on HiDPI screens. The extra device-pixel density
 * is fed to pdfjs via the `transform` matrix `[dpr,0,0,dpr,0,0]` so the drawing
 * scales to fill the larger backing store.
 *
 * Cancellation strategy (Req 4.1): page-level render state (the live
 * `RenderTask`) is held here in the composable, never in the store (design.md
 * line 108). A new `render()` first cancels any in-flight task; pdfjs then
 * rejects that task's promise with `RenderingCancelledException`, which is
 * normal flow during a zoom burst and is swallowed rather than surfaced as an
 * error.
 */
import { RenderingCancelledException } from '@/lib/pdf/pdfjs'
import type { PDFPageProxy, RenderTask } from '@/lib/pdf/pdfjs'

export interface UsePdfPageRender {
  /**
   * Render `page` at `scale` into `canvas`, DPR-aware. Cancels any previous
   * in-flight render first (Req 4.1). Resolves when the render completes (or
   * was cancelled — cancellation is swallowed); rejects on any real render
   * error.
   *
   * @throws if the canvas has no obtainable 2D context.
   */
  render(
    canvas: HTMLCanvasElement,
    page: PDFPageProxy,
    scale: number,
  ): Promise<void>
  /** Cancel the in-flight render, if any (no-op otherwise). */
  cancel(): void
}

/**
 * Detect pdfjs' render-cancellation exception. Prefer `instanceof` against the
 * boundary-surfaced class; fall back to `.name` because under a pdfjs major
 * upgrade (or a mocked task in tests) the rejection value may not be an
 * instance of the exact class but still carries the canonical name.
 */
function isRenderingCancelled(err: unknown): boolean {
  if (
    typeof RenderingCancelledException === 'function' &&
    err instanceof RenderingCancelledException
  ) {
    return true
  }
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === 'RenderingCancelledException'
  )
}

export function usePdfPageRender(): UsePdfPageRender {
  // The live render task. Held in the composable (not the store) per design.md
  // line 108 (描画状態は composables 内で保持).
  let activeTask: RenderTask | null = null

  function cancel(): void {
    if (activeTask === null) return
    activeTask.cancel()
  }

  async function render(
    canvas: HTMLCanvasElement,
    page: PDFPageProxy,
    scale: number,
  ): Promise<void> {
    // 1) Cancel the previous render before starting a new one (Req 4.1). Its
    //    promise will reject with RenderingCancelledException, swallowed below.
    if (activeTask !== null) {
      activeTask.cancel()
    }

    // 2) Compute the viewport at the requested scale.
    const viewport = page.getViewport({ scale })

    // 3) DPR sizing (Req 2.2): backing store ×dpr, CSS box = viewport dims.
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(viewport.width * dpr)
    canvas.height = Math.floor(viewport.height * dpr)
    canvas.style.width = `${Math.floor(viewport.width)}px`
    canvas.style.height = `${Math.floor(viewport.height)}px`

    // Obtain the 2D context up front so a missing context fails clearly before
    // any RenderTask is created (jsdom returns null; real browsers don't).
    const ctx = canvas.getContext('2d')
    if (ctx === null) {
      throw new Error(
        'usePdfPageRender: canvas 2D context is unavailable (getContext("2d") returned null).',
      )
    }

    // 4) Render via the pdfjs v6 API. Feed the DPR through `transform` so the
    //    drawing fills the ×dpr backing store; omit it at dpr=1.
    const transform: number[] | undefined =
      dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
    // pdfjs v6: when a context is supplied explicitly, `canvas` must be null
    // (it derives the canvas from the context). See RenderParameters docs.
    const task = page.render({
      canvas: null,
      canvasContext: ctx,
      viewport,
      transform,
    })
    activeTask = task

    try {
      // 5) Await completion. A cancellation (zoom burst / unmount) is normal
      //    flow — swallow it; re-throw anything else (Req 4.1, design L492).
      await task.promise
    } catch (err) {
      if (isRenderingCancelled(err)) return
      throw err
    } finally {
      // 6) Clear the stored task only if it is still the one we started; a
      //    newer render() may have replaced it while we awaited.
      if (activeTask === task) {
        activeTask = null
      }
    }
  }

  return { render, cancel }
}
