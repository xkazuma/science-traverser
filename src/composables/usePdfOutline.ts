/**
 * Outline (bookmark) composable (design.md "Composables → usePdfOutline", Req 5.1, 5.2, 5.5).
 *
 * Reads the PDF document outline (bookmarks) and resolves each entry's
 * destination to a concrete page number so the sidebar (task 4.6) can render a
 * navigable tree and jump to the target page.
 *
 * Boundary commitment (design.md "Boundary Commitments"): this module reaches
 * pdfjs ONLY through the `@/lib/pdf/pdfjs` boundary (types only here) — it never
 * imports `pdfjs-dist` directly.
 *
 * Page-number convention: `OutlineNode.pageIndex` keeps the field name declared
 * by the design type but its VALUE is the **1-origin page number** (consistent
 * with `pdfStore.currentPage` and `requestGoToPage`, both 1-origin). pdfjs'
 * `getPageIndex` returns a 0-based index; we add 1.
 */
import type { PDFDocumentProxy } from '@/lib/pdf/pdfjs'

/**
 * A single outline (bookmark) entry.
 *
 * @property title     Display label of the bookmark.
 * @property pageIndex 1-origin page NUMBER the bookmark targets, or `null` when
 *                     the destination is absent / unresolvable. (Field name is
 *                     `pageIndex` per design.md; value is 1-origin, see header.)
 * @property children  Nested child bookmarks (empty array when none).
 */
export interface OutlineNode {
  title: string
  pageIndex: number | null
  children: OutlineNode[]
}

export interface UsePdfOutline {
  /** しおり取得＋移動先解決。アウトラインが無い場合は空配列（Req 5.1, 5.5）。 */
  load(doc: PDFDocumentProxy): Promise<OutlineNode[]>
  /** 移動先(dest)を 1-origin ページ番号へ解決。解決不能なら null（Req 5.2）。 */
  resolveDest(dest: unknown, doc: PDFDocumentProxy): Promise<number | null>
}

/** pdfjs `getOutline()` が返す raw 項目のうち、本 composable が参照する部分。 */
interface RawOutlineItem {
  title: string
  dest: string | unknown[] | null
  items: RawOutlineItem[]
}

/** pdfjs のページ参照（`RefProxy`）形。dest 配列の先頭要素がこれ。 */
interface RefProxyLike {
  num: number
  gen: number
}

function isRefProxyLike(value: unknown): value is RefProxyLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { num?: unknown }).num === 'number' &&
    typeof (value as { gen?: unknown }).gen === 'number'
  )
}

export function usePdfOutline(): UsePdfOutline {
  async function resolveDest(
    dest: unknown,
    doc: PDFDocumentProxy,
  ): Promise<number | null> {
    try {
      // 名前付き移動先（文字列）→ 明示配列へ解決。
      const explicit: unknown[] | null =
        typeof dest === 'string'
          ? await doc.getDestination(dest)
          : Array.isArray(dest)
            ? dest
            : null

      if (explicit === null || explicit.length === 0) return null

      // 明示配列の先頭要素がページ参照（RefProxy）。
      const ref = explicit[0]
      if (!isRefProxyLike(ref)) return null

      // 0-based ページインデックス → 1-origin ページ番号。
      const pageIndex = await doc.getPageIndex(ref)
      return pageIndex + 1
    } catch {
      // 未対応 dest / 壊れた参照などは解決不能として null（throw しない）。
      return null
    }
  }

  async function mapItem(
    item: RawOutlineItem,
    doc: PDFDocumentProxy,
  ): Promise<OutlineNode> {
    const pageIndex = await resolveDest(item.dest, doc)
    const children = await mapItems(item.items, doc)
    return { title: item.title, pageIndex, children }
  }

  function mapItems(
    items: readonly RawOutlineItem[],
    doc: PDFDocumentProxy,
  ): Promise<OutlineNode[]> {
    return Promise.all(items.map((item) => mapItem(item, doc)))
  }

  async function load(doc: PDFDocumentProxy): Promise<OutlineNode[]> {
    // pdfjs はアウトラインが無いと null を返す（Req 5.5: 空配列で「無い」と判る）。
    const raw = (await doc.getOutline()) as RawOutlineItem[] | null
    if (raw === null || raw.length === 0) return []
    return mapItems(raw, doc)
  }

  return { load, resolveDest }
}
