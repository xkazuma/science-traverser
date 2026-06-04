/**
 * Text-layer composable (design.md "Composables → usePdfTextLayer", Req 2.3).
 *
 * Builds the per-page *selectable* text overlay so users can select and copy a
 * page's text. The text layer is constructed with the same origin and the same
 * dimensions as the canvas layer (design.md L382: "テキスト層は canvas と同一
 * 原点・同寸") so the invisible, selectable glyphs sit exactly over the painted
 * page image at every zoom level (Req 2.4 position alignment).
 *
 * Boundary commitment (design.md "Boundary Commitments"): pdfjs is reached ONLY
 * through `@/lib/pdf/pdfjs` — never `pdfjs-dist` directly. The v6 `TextLayer`
 * class is surfaced there.
 *
 * pdfjs v6 API (design.md, tasks.md Implementation Notes): the v6 text layer is
 * the `TextLayer` *class* — `new TextLayer({ textContentSource, container,
 * viewport })` then `await layer.render()` — NOT the old `renderTextLayer()`
 * helper. `getTextContent()` runs without canvas/Worker, so this path works in
 * jsdom. v6 positions every glyph relative to the container's `--scale-factor`
 * CSS variable: it MUST equal the viewport scale or the text is mis-aligned
 * against the canvas.
 */
import { TextLayer } from '@/lib/pdf/pdfjs'
import type { PageViewport, PDFPageProxy } from '@/lib/pdf/pdfjs'

export interface UsePdfTextLayer {
  /**
   * Build the selectable text layer for `page` into `container`, laid out for
   * `viewport`. Idempotent: clears any previous content first, so re-rendering
   * the same container (e.g. on zoom) never duplicates nodes. Resolves when the
   * text layer has been laid out into the DOM.
   */
  render(
    container: HTMLElement,
    page: PDFPageProxy,
    viewport: PageViewport,
  ): Promise<void>
  /** Cancel the in-flight text-layer render, if any (no-op otherwise). */
  cancel(): void
}

export function usePdfTextLayer(): UsePdfTextLayer {
  // The live text layer. Held in the composable (not the store), mirroring the
  // page-render composable: per-page render state stays local (design.md L108).
  // `TextLayer` is surfaced by the boundary as a value (const); derive its
  // instance type via `InstanceType` rather than importing the class as a type.
  let activeLayer: InstanceType<typeof TextLayer> | null = null

  function cancel(): void {
    if (activeLayer === null) return
    activeLayer.cancel()
    activeLayer = null
  }

  async function render(
    container: HTMLElement,
    page: PDFPageProxy,
    viewport: PageViewport,
  ): Promise<void> {
    // 1) Cancel any in-flight layer and clear the container so a re-render
    //    (e.g. zoom change) replaces — never appends to — prior text nodes.
    cancel()
    container.replaceChildren()

    // 2) v6 sizes the layer box and every glyph relative to `--total-scale-factor`
    //    (NOT `--scale-factor`): `setLayerDimensions()` sets width/height via
    //    `round(down, var(--total-scale-factor) * pageW px, var(--scale-round-x))`
    //    and the glyph font-size CSS uses `--total-scale-factor`. It MUST equal
    //    the viewport scale or the text drifts/mis-sizes against the canvas
    //    (Req 2.4 position alignment). Must be set BEFORE the TextLayer
    //    constructor. `--scale-factor` is kept for compatibility (pdfjs defines
    //    `--total-scale-factor: calc(var(--scale-factor) * var(--user-unit))`,
    //    user-unit defaulting to 1). The component (task 3.5) absolutely-positions
    //    this container over the canvas (same origin + same dims, design.md L382).
    container.style.setProperty('--scale-factor', String(viewport.scale))
    container.style.setProperty('--total-scale-factor', String(viewport.scale))

    // 3) Stream the page's text content (no canvas/Worker needed) and lay it out
    //    via the v6 TextLayer class. Its constructor calls
    //    `setLayerDimensions(container, viewport)`, sizing the layer to the page
    //    box via `--total-scale-factor` so it overlays the canvas at every zoom.
    const textContentSource = page.streamTextContent()
    const textLayer = new TextLayer({ textContentSource, container, viewport })
    activeLayer = textLayer

    try {
      await textLayer.render()
    } finally {
      // Clear the stored layer only if it is still the one we started; a newer
      // render() may have replaced it while we awaited.
      if (activeLayer === textLayer) {
        activeLayer = null
      }
    }
  }

  return { render, cancel }
}
