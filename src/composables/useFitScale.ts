/**
 * フィット倍率算出 composable（design.md「ズーム/フィット」/ 要件 4.3, 4.4, 4.5）。
 *
 * **本モジュールがフィット倍率算出の唯一の所在地**。task 3.4 の再算出
 * （`usePageVirtualizer.recompute(scale)`）へ渡す `scale` を確定する。実際の結線
 * （ResizeObserver 登録・`store.setScale` 呼び出し）は `PdfViewport.vue` が担う。
 *
 * フィット基準はコンテナ幅基準に統一（design.md「フィット基準はコンテナ幅基準に
 * 統一」/ validate-design refinement）:
 * - `'width'` → 最も広いページがコンテナ幅に収まる単一 scale
 *   = `containerWidth / 最広ページの有効幅`。
 * - `'page'`  → 最も広い／高いページが表示領域に収まる単一 scale
 *   = `min(containerWidth / 最広有効幅, containerHeight / 最高有効高)`。
 * - `'none'`  → `null`（フィットしない＝手動倍率を維持）。
 *
 * 回転（90/270）はページの有効幅高を入れ替えて計算する。任意の `padding`（px）は
 * コンテナの有効領域を上下左右から差し引く（既定 0）。結果は副作用なく
 * `[SCALE_MIN, SCALE_MAX]` にクランプして返す（store.setScale も同じ範囲でクランプ
 * するため二重に安全側）。純粋関数であり pdfjs/DOM に依存しない（テスト容易）。
 */
import { SCALE_MAX, SCALE_MIN } from '@/stores/pdfStore'
import type { FitMode } from '@/types/pdf'

/** フィット算出に必要な 1 ページの寸法・回転（PDF 単位、回転適用前）。 */
export interface FitPageDimension {
  /** PDF 単位の幅（回転適用前）。 */
  widthPdf: number
  /** PDF 単位の高さ（回転適用前）。 */
  heightPdf: number
  /** ページ回転（度）。90/270 で有効幅高を入れ替える。 */
  rotation: number
}

/** フィット対象のコンテナ内容領域サイズ（px）。 */
export interface FitContainerSize {
  width: number
  height: number
}

/** `computeFitScale` のオプション。 */
export interface FitScaleOptions {
  /**
   * コンテナ有効領域から差し引く内側余白（px）。上下左右それぞれに適用するため
   * 有効幅は `width - 2 * padding`、有効高は `height - 2 * padding` となる。既定 0。
   */
  padding?: number
}

/** 値を [min, max] に収める（純粋ヘルパ）。 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** 回転 90/270 のとき幅高を入れ替えた「有効寸法」を返す（純粋）。 */
function effectiveSize(dim: FitPageDimension): {
  width: number
  height: number
} {
  const normalized = ((dim.rotation % 360) + 360) % 360
  const swap = normalized === 90 || normalized === 270
  return {
    width: swap ? dim.heightPdf : dim.widthPdf,
    height: swap ? dim.widthPdf : dim.heightPdf,
  }
}

/**
 * フィット倍率を算出する（純粋・本機能の単一の真実源）。
 *
 * @param fitMode  'none' | 'width' | 'page'
 * @param container コンテナ内容領域サイズ（px）
 * @param pages    各ページの PDF 単位寸法・回転（回転適用前）
 * @param opts     padding 等のオプション
 * @returns 算出 scale（[SCALE_MIN, SCALE_MAX] にクランプ）。フィット不能・
 *          `'none'`・無効入力（空配列・非正のサイズ）の場合は `null`。
 */
export function computeFitScale(
  fitMode: FitMode,
  container: FitContainerSize,
  pages: ReadonlyArray<FitPageDimension>,
  opts: FitScaleOptions = {},
): number | null {
  if (fitMode === 'none') return null
  if (pages.length === 0) return null

  const padding = opts.padding ?? 0
  const availWidth = container.width - 2 * padding
  const availHeight = container.height - 2 * padding
  if (availWidth <= 0) return null

  // 全ページ共通の単一 scale を得るため、最広/最高ページを基準にする。
  let maxWidth = 0
  let maxHeight = 0
  for (const page of pages) {
    const { width, height } = effectiveSize(page)
    if (width > maxWidth) maxWidth = width
    if (height > maxHeight) maxHeight = height
  }
  if (maxWidth <= 0) return null

  const widthScale = availWidth / maxWidth

  if (fitMode === 'width') {
    return clamp(widthScale, SCALE_MIN, SCALE_MAX)
  }

  // 'page': 幅・高さの両制約のうち厳しい方（min）。高さが取れないなら幅律速のみ。
  if (availHeight <= 0 || maxHeight <= 0) {
    return clamp(widthScale, SCALE_MIN, SCALE_MAX)
  }
  const heightScale = availHeight / maxHeight
  return clamp(Math.min(widthScale, heightScale), SCALE_MIN, SCALE_MAX)
}
