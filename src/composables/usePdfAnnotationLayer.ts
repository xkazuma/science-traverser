/**
 * Link/cross-reference annotation-layer composable (design.md "Composables →
 * usePdfAnnotationLayer", Req 9.1, 9.4).
 *
 * Builds the per-page *clickable link* overlay so users can follow internal
 * cross-references (GoTo) and external URLs in a PDF. The annotation layer is
 * constructed with the same origin and the same dimensions as the canvas/text
 * layers so the clickable `<a>` hit-areas sit exactly over the painted links at
 * every zoom level (Req 9.4 position alignment).
 *
 * Boundary commitment (design.md "Boundary Commitments"): pdfjs is reached ONLY
 * through `@/lib/pdf/pdfjs` — never `pdfjs-dist` directly. The v6
 * `AnnotationLayer` class is surfaced there.
 *
 * pdfjs v6 API (verified against pdfjs-dist@6.0.227 `AnnotationLayer`):
 * - constructor `new AnnotationLayer({ div, page, viewport, linkService,
 *   annotationStorage? })`; when `annotationStorage` is omitted the layer
 *   creates its own (we only display links, so we don't need to share one).
 * - `await layer.render({ annotations, renderForms: false })` — the link path
 *   needs no canvas, so it runs under jsdom.
 * - the layer box is sized by `setLayerDimensions(div, viewport)`, which uses
 *   `var(--total-scale-factor)`; we set it (mirroring the text layer) so the
 *   box and link hit-areas align with the canvas (Req 9.4).
 * - `getAnnotations({ intent: 'display' })` returns the page's annotations; the
 *   viewport is `clone({ dontFlip: true })` (annotation rects are in PDF
 *   bottom-up coordinates; the layer flips internally).
 */
import { toRaw } from 'vue'

import { AnnotationLayer } from '@/lib/pdf/pdfjs'
import type { PageViewport, PDFPageProxy } from '@/lib/pdf/pdfjs'
import type { PdfLinkService } from '@/composables/usePdfLinkService'

export interface UsePdfAnnotationLayer {
  /**
   * Build the clickable link annotation layer for `page` into `container`, laid
   * out for `viewport`, wiring clicks to `linkService`. Idempotent: clears any
   * previous content first, so re-rendering the same container (e.g. on zoom)
   * never duplicates anchors. Resolves when the layer has been laid out.
   */
  render(
    container: HTMLElement,
    page: PDFPageProxy,
    viewport: PageViewport,
    linkService: PdfLinkService,
  ): Promise<void>
}

export function usePdfAnnotationLayer(): UsePdfAnnotationLayer {
  async function render(
    container: HTMLElement,
    page: PDFPageProxy,
    viewport: PageViewport,
    linkService: PdfLinkService,
  ): Promise<void> {
    // pdfjs objects (PDFPageProxy / PageViewport) must be the raw objects, not
    // Vue reactive proxies, or pdfjs' internal WeakMap keys / `this` binding
    // break (mirrors the text layer). The caller already toRaw's; defend again.
    const rawPage = toRaw(page)
    const rawViewport = toRaw(viewport)

    // 1) Clear so a re-render (e.g. zoom change) replaces — never appends to —
    //    prior anchors (idempotent).
    container.replaceChildren()

    // 2) v6 sizes the layer box relative to `--total-scale-factor` via
    //    `setLayerDimensions()`. It MUST equal the viewport scale or the link
    //    hit-areas drift from the canvas (Req 9.4). `--scale-factor` is set for
    //    compatibility, matching the text layer.
    container.style.setProperty('--scale-factor', String(rawViewport.scale))
    container.style.setProperty('--total-scale-factor', String(rawViewport.scale))

    // 3) Read the page's display-intent annotations (link annotations included).
    //    Runs without canvas/Worker, so it works under jsdom.
    const annotations = await rawPage.getAnnotations({ intent: 'display' })

    // 4) The annotation layer expects a NON-flipped viewport (`dontFlip:true`):
    //    annotation rects are in PDF user space (bottom-up); the layer applies
    //    its own flip. Using the canvas viewport directly would double-flip.
    const annoViewport = rawViewport.clone({ dontFlip: true })

    // 5) Build + render. `renderForms:false` — this viewer surfaces links only,
    //    not interactive form fields. annotationStorage is omitted; the layer
    //    creates its own internally (we don't share form state).
    //
    //    pdfjs types the constructor params loosely and require a full
    //    `PDFLinkService` for `linkService`; our minimal service only implements
    //    the link path the AnnotationLayer actually reads. Cast at this single
    //    pdfjs boundary (design.md allows `as unknown as` at the seam), keeping
    //    the rest of the module strictly typed.
    const ctorParams = {
      div: container,
      page: rawPage,
      viewport: annoViewport,
      linkService,
    } as unknown as ConstructorParameters<typeof AnnotationLayer>[0]
    const layer = new AnnotationLayer(ctorParams)

    const renderParams = {
      annotations,
      renderForms: false,
    } as unknown as Parameters<InstanceType<typeof AnnotationLayer>['render']>[0]
    await layer.render(renderParams)
  }

  return { render }
}
