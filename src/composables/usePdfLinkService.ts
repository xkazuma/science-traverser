/**
 * Minimal pdfjs `IPDFLinkService` implementation (design.md "Composables →
 * usePdfLinkService", Req 9.2, 9.3).
 *
 * pdfjs' `AnnotationLayer` binds every clickable link annotation to a
 * *link service*: internal GoTo links call `linkService.goToDestination(dest)`,
 * external URLs call `linkService.addLinkAttributes(link, url, newWindow)`, and
 * named actions call `linkService.executeNamedAction(action)` (verified in
 * pdfjs v6.0.227 `LinkAnnotationElement`). pdfjs ships a full `PDFLinkService`
 * only in its `web/` bundle (not the main entry behind our boundary), so we
 * provide the small surface the `AnnotationLayer` link path actually reads,
 * wired to this app's single-source-of-truth store.
 *
 * Navigation contract:
 * - Internal dest (Req 9.2): resolve the destination to a 1-origin page number
 *   (REUSING `usePdfOutline().resolveDest`, which handles named-string and
 *   explicit-array dests and clamps to a real page) and request a jump via
 *   `store.requestGoToPage` (out-of-range / unresolvable dests are ignored by
 *   the store — current view preserved).
 * - External URL (Req 9.3): rendered as a normal `<a>` opening in a new tab with
 *   `rel="noopener noreferrer"` (no in-app navigation; the browser handles it).
 *
 * Boundary commitment (design.md "Boundary Commitments"): this module reaches
 * pdfjs ONLY through the `@/lib/pdf/pdfjs` boundary (types only here) — it never
 * imports `pdfjs-dist` directly.
 *
 * Pinia note: each method resolves the store lazily via `usePdfStore()` rather
 * than capturing it at factory time, so a component can construct the link
 * service at setup even outside an active Pinia (the store is only needed once a
 * link is actually clicked). The pdfjs `AnnotationLayer` only invokes these
 * methods on user interaction.
 */
import { toRaw } from 'vue'

import { usePdfOutline } from '@/composables/usePdfOutline'
import type { PDFDocumentProxy } from '@/lib/pdf/pdfjs'
import { usePdfStore } from '@/stores/pdfStore'

/** A pdfjs link destination: a named destination (string) or explicit array. */
export type PdfDestination = string | unknown[]

/**
 * Minimal event bus stub. pdfjs' annotation layer reads `linkService.eventBus`
 * (e.g. for JS/reset-form actions, which this viewer does not enable) and may
 * call `.dispatch`/`.on`/`.off`; provide inert no-ops so it never throws.
 */
export interface MinimalEventBus {
  on(...args: unknown[]): void
  off(...args: unknown[]): void
  dispatch(...args: unknown[]): void
}

/**
 * The subset of pdfjs' `IPDFLinkService` surface the v6 `AnnotationLayer` link
 * path reads. Mirrors the property/method shape of pdfjs' `SimpleLinkService`
 * so the `AnnotationLayer` accepts it, while the navigation methods route into
 * this app's store.
 */
export interface PdfLinkService {
  readonly externalLinkEnabled: boolean
  externalLinkTarget: string | null
  externalLinkRel: string | null
  readonly isInPresentationMode: boolean
  readonly rotation: number
  readonly pagesCount: number
  page: number
  readonly eventBus: MinimalEventBus
  goToDestination(dest: PdfDestination): Promise<void>
  goToPage(pageNumber: number): void
  getDestinationHash(dest: PdfDestination): string
  getAnchorUrl(hash: string): string
  addLinkAttributes(
    link: HTMLAnchorElement,
    url: string,
    newWindow?: boolean,
  ): void
  executeNamedAction(action: string): void
  executeSetOCGState(): void
}

export function usePdfLinkService(): PdfLinkService {
  const outline = usePdfOutline()

  const eventBus: MinimalEventBus = {
    on(): void {},
    off(): void {},
    dispatch(): void {},
  }

  return {
    // pdfjs reads these to decide external-link handling / presentation mode /
    // rotation. We render external links ourselves in `addLinkAttributes`, so
    // these are mostly informational; mirror the SimpleLinkService defaults.
    externalLinkEnabled: true,
    externalLinkTarget: null,
    externalLinkRel: null,
    isInPresentationMode: false,
    rotation: 0,
    eventBus,

    get pagesCount(): number {
      return usePdfStore().numPages
    },

    get page(): number {
      return usePdfStore().currentPage
    },
    set page(value: number) {
      usePdfStore().requestGoToPage(value)
    },

    /**
     * Internal GoTo / cross-reference (Req 9.2). Resolve the destination to a
     * 1-origin page number and request a jump. Unresolvable / out-of-range
     * dests are no-ops (resolveDest returns null; the store ignores bad pages).
     */
    async goToDestination(dest: PdfDestination): Promise<void> {
      const store = usePdfStore()
      const doc = store.doc
      if (doc === null) return
      // toRaw: the store holds a markRaw'd doc, but resolveDest may run against
      // it via pdfjs internals; pass the genuine object (mirrors text layer).
      const rawDoc = toRaw(doc) as PDFDocumentProxy
      const page = await outline.resolveDest(dest, rawDoc)
      if (page !== null) {
        store.requestGoToPage(page)
      }
    },

    /** Direct page jump (1-origin). Out-of-range ignored by the store. */
    goToPage(pageNumber: number): void {
      usePdfStore().requestGoToPage(pageNumber)
    },

    /**
     * Internal-link href. We navigate via `goToDestination` (onclick returns
     * false), so the href is only a placeholder; a bare '#' avoids a real
     * navigation while keeping the anchor focusable.
     */
    getDestinationHash(): string {
      return '#'
    },

    /** Anchor URL for action links. Placeholder (handled via onclick). */
    getAnchorUrl(hash: string): string {
      return hash || '#'
    },

    /**
     * External URL (Req 9.3). pdfjs calls this for link annotations carrying a
     * URL. Open in a new tab with `rel="noopener noreferrer"` so the opened
     * page cannot reach back into this viewer.
     */
    addLinkAttributes(
      link: HTMLAnchorElement,
      url: string,
      newWindow = false,
    ): void {
      void newWindow
      link.href = url
      if (url) {
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
      }
    },

    /** Named viewer actions (Next/Prev/First/Last page). Others: no-op. */
    executeNamedAction(action: string): void {
      const store = usePdfStore()
      switch (action) {
        case 'NextPage':
          store.requestGoToPage(store.currentPage + 1)
          break
        case 'PrevPage':
          store.requestGoToPage(store.currentPage - 1)
          break
        case 'FirstPage':
          store.requestGoToPage(1)
          break
        case 'LastPage':
          store.requestGoToPage(store.numPages)
          break
        default:
          // GoBack / GoForward / etc. are not supported by this viewer.
          break
      }
    },

    /** Optional-content (layer visibility) toggling is not supported. No-op. */
    executeSetOCGState(): void {},
  }
}
