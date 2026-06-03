/**
 * 仮想化 composable（design.md "Composables → usePageVirtualizer"、Req 2.1, 3.2,
 * 6.1, 6.2, 6.3, 6.4）。
 *
 * 役割:
 * - **プレースホルダ高さ確保（6.2）**: 各ページ固有の `PageDimension` × 現在 `scale`
 *   から個別高さを算出し、ギャップを挟んだ累積 `offsetTop` を全ページ分そろえる。
 *   これにより未描画でもスクロール総量が正しく確保される（連続表示 2.1 の土台）。
 * - **近傍描画（6.1, 6.3）**: `IntersectionObserver`（±1ビューポート相当のルート
 *   マージン）で各ページ要素の交差を観測し、表示領域付近のページ番号のみを
 *   `visiblePages` に保持する。新領域へスクロールすると入ってきたページが加わる。
 * - **遠方解放（6.4）**: `releaseFar()` は観測中だが非可視のページ番号を返す。
 *   この composable は `PDFPageProxy` を保持しないため、解放の実体（`page.cleanup()`）
 *   は consumer（PdfViewport / PdfPage、後続タスク）が返り値を使って行う。
 * - **追従（3.2）**: 交差比が最大のページを `activePage` に反映する。
 * - **ジャンプ（3.4, 5.2, 5.4）**: `offsetOf(n)` がプレースホルダ由来の絶対
 *   `offsetTop` を返す。範囲外はクランプ。
 * - **再算出（4.x, 6.2）**: `recompute(scale)` が与えられた `scale` でプレースホルダを
 *   再算出する（**フィット倍率そのものは算出しない**。それは別タスク 5.2 が担う）。
 *
 * 境界: pdfjs には依存しない。入力は `PageDimension[]`（または `Ref`）であり、
 * caller が読み込み済みドキュメントの各ページから導出して渡す。
 */
import { computed, ref, shallowRef } from 'vue'
import type { Ref } from 'vue'

/** 1ページの固有寸法・回転（PDF 単位、`PDFPageProxy` から導出）。 */
export interface PageDimension {
  pageNumber: number
  /** PDF 単位の幅（回転適用前）。 */
  widthPdf: number
  /** PDF 単位の高さ（回転適用前）。 */
  heightPdf: number
  /** ページ回転（度）。90/270 で幅高を入れ替える。 */
  rotation: number
}

/** 算出済みプレースホルダ（レイアウト px 単位）。 */
export interface PagePlaceholder {
  pageNumber: number
  /** scale 適用後の表示幅（回転反映済み）。 */
  width: number
  /** scale 適用後の表示高さ（回転反映済み）。 */
  height: number
  /** スクロール容器内の絶対 offsetTop（先行ページ高 + ギャップの累積）。 */
  offsetTop: number
}

/** `usePageVirtualizer` のオプション。 */
export interface PageVirtualizerOptions {
  /**
   * 可視ページの前後に保持する近傍数の目安（6.1 の「付近」）。`releaseFar` の
   * 判定には直接使わない（交差状態が真実源）が、`IntersectionObserver` の
   * ルートマージンを ±overscan ビューポートぶん広げる係数として用いる。既定 1。
   */
  overscan?: number
  /** ページ間の固定ギャップ（レイアウト px）。scale で拡縮しない。既定 0。 */
  gap?: number
}

/** 公開インターフェース（design.md "UsePageVirtualizer"）。 */
export interface UsePageVirtualizer {
  /** 全ページ分の寸法事前確保（6.2）。 */
  placeholders: Readonly<Ref<PagePlaceholder[]>>
  /** 近傍±Nのみ描画（6.1, 6.3）。 */
  visiblePages: Readonly<Ref<number[]>>
  /** ページ要素を観測対象に追加（番号と紐付け）。 */
  observe(pageEl: Element, pageNumber: number): void
  /** 遠方（非可視）の観測ページ番号を返す。解放の実体は consumer（6.4）。 */
  releaseFar(): number[]
  /** スクロール追従で最も可視なページ番号（3.2）。 */
  activePage: Readonly<Ref<number>>
  /** ジャンプ先の絶対 offsetTop。範囲外はクランプ（3.4, 5.2, 5.4）。 */
  offsetOf(pageNumber: number): number
  /** 与えられた scale でプレースホルダを再算出（4.x, 6.2）。fit 倍率は算出しない。 */
  recompute(scale: number): void
  /** 観測解除と内部状態クリア（アンマウント時）。 */
  destroy(): void
}

/** 回転を 90 / 270 のとき幅高を入れ替えて scale 適用した寸法を返す（純粋）。 */
function scaledSize(
  dim: PageDimension,
  scale: number,
): { width: number; height: number } {
  const normalized = ((dim.rotation % 360) + 360) % 360
  const swap = normalized === 90 || normalized === 270
  const w = swap ? dim.heightPdf : dim.widthPdf
  const h = swap ? dim.widthPdf : dim.heightPdf
  return { width: w * scale, height: h * scale }
}

/**
 * 寸法配列 × scale × gap から全プレースホルダを算出する（純粋・6.2）。
 * `offsetTop` は先行ページ高とギャップの累積。
 */
function computePlaceholders(
  dimensions: ReadonlyArray<PageDimension>,
  scale: number,
  gap: number,
): PagePlaceholder[] {
  const result: PagePlaceholder[] = []
  let cursor = 0
  for (let i = 0; i < dimensions.length; i += 1) {
    const dim = dimensions[i]
    const { width, height } = scaledSize(dim, scale)
    result.push({
      pageNumber: dim.pageNumber,
      width,
      height,
      offsetTop: cursor,
    })
    cursor += height
    if (i < dimensions.length - 1) cursor += gap
  }
  return result
}

export function usePageVirtualizer(
  pageDimensions: Ref<PageDimension[]> | PageDimension[],
  initialScale: number,
  opts: PageVirtualizerOptions = {},
): UsePageVirtualizer {
  const overscan = opts.overscan ?? 1
  const gap = opts.gap ?? 0

  // 入力寸法を Ref に正規化（配列で渡された場合も reactive に扱えるよう包む）。
  const dims: Ref<PageDimension[]> = Array.isArray(pageDimensions)
    ? ref(pageDimensions)
    : pageDimensions

  // 現在の描画倍率（recompute で更新）。
  const scale = ref(initialScale)

  // プレースホルダは寸法 / scale / gap の純関数。dims か scale の変化で再算出される。
  const placeholders = computed<PagePlaceholder[]>(() =>
    computePlaceholders(dims.value, scale.value, gap),
  )

  // 各ページ番号 → 現在の交差比。非可視は除外（map に存在しない）。
  const ratios = ref(new Map<number, number>())
  // 観測中の全ページ要素（element → pageNumber、releaseFar の母集合）。
  const observedPages = ref(new Set<number>())
  // element → pageNumber 逆引き（IntersectionObserver entry から番号を引く）。
  const elementToPage = new WeakMap<Element, number>()

  // ±overscan ビューポート相当の余白で「付近」を可視扱いにする（6.1）。
  // jsdom/test 環境ではコンストラクタが stub される。
  const observer = shallowRef<IntersectionObserver | null>(null)
  if (typeof IntersectionObserver !== 'undefined') {
    observer.value = new IntersectionObserver(onIntersect, {
      // ルートマージンを overscan ビューポートぶん上下に広げる（±100% = ±1画面）。
      rootMargin: `${overscan * 100}% 0px ${overscan * 100}% 0px`,
      threshold: [0, 0.01, 0.25, 0.5, 0.75, 1],
    })
  }

  function onIntersect(entries: IntersectionObserverEntry[]): void {
    const next = new Map(ratios.value)
    for (const entry of entries) {
      const page = elementToPage.get(entry.target)
      if (page === undefined) continue
      if (entry.isIntersecting) {
        next.set(page, entry.intersectionRatio)
      } else {
        next.delete(page)
      }
    }
    ratios.value = next
    updateActivePage(next)
  }

  /**
   * 交差比が最大のページを active に反映する（同率は小さいページ番号を優先）。
   * 交差イベント内で同期更新し、追従（3.2）がスクロール直後に観測できるよう
   * 非同期 watch を介さない。
   */
  function updateActivePage(map: ReadonlyMap<number, number>): void {
    let best = -1
    let bestRatio = -1
    for (const [page, ratio] of map) {
      if (ratio > bestRatio || (ratio === bestRatio && page < best)) {
        best = page
        bestRatio = ratio
      }
    }
    if (best !== -1) activePage.value = best
  }

  function observe(pageEl: Element, pageNumber: number): void {
    elementToPage.set(pageEl, pageNumber)
    const set = new Set(observedPages.value)
    set.add(pageNumber)
    observedPages.value = set
    observer.value?.observe(pageEl)
  }

  // 近傍のみ（交差中のページ番号、昇順）。新領域スクロールで増減（6.1, 6.3）。
  const visiblePages = computed<number[]>(() =>
    [...ratios.value.keys()].sort((a, b) => a - b),
  )

  // 観測中だが非可視のページ番号（解放候補）。実体解放は consumer（6.4）。
  function releaseFar(): number[] {
    const visible = ratios.value
    return [...observedPages.value]
      .filter((p) => !visible.has(p))
      .sort((a, b) => a - b)
  }

  // 交差比が最大のページ（同率は小さいページ番号を優先）。既定 1。
  // `onIntersect` 内で同期更新される（updateActivePage）。
  const activePage = ref(1)

  function offsetOf(pageNumber: number): number {
    const ph = placeholders.value
    if (ph.length === 0) return 0
    const found = ph.find((p) => p.pageNumber === pageNumber)
    if (found !== undefined) return found.offsetTop
    // 範囲外: 先頭より小さければ先頭、末尾より大きければ末尾へクランプ。
    const first = ph[0]
    const last = ph[ph.length - 1]
    if (pageNumber <= first.pageNumber) return first.offsetTop
    return last.offsetTop
  }

  function recompute(nextScale: number): void {
    scale.value = nextScale
  }

  function destroy(): void {
    observer.value?.disconnect()
    observer.value = null
    ratios.value = new Map()
    observedPages.value = new Set()
  }

  return {
    placeholders,
    visiblePages,
    observe,
    releaseFar,
    activePage,
    offsetOf,
    recompute,
    destroy,
  }
}
