/**
 * PDF 単位 ⇄ 表示レイヤ px の座標変換（純粋関数）。
 *
 * design.md "Components and Interfaces" → "Lib" → `coordinates` /
 * requirements 2.4（全ズームでレイヤ整合）, 8.2（PDF文書座標と表示座標を相互変換する手段）。
 *
 * 設計方針（steering tech.md「座標系（拡張性の要）」）:
 * 永続データは PDF 単位（左下原点・無倍率）で保持し、表示時に対象ページ・対象
 * 倍率の `PageViewport` で再射影する。これによりズーム/再描画をまたいでレイヤ
 * 整合が保たれる（倍率変更は `vp` の差し替えだけで吸収され、PDF 単位値は不変）。
 *
 * 境界規約（task 1.3 の single-import-boundary 不変条件）:
 * このモジュールは `pdfjs-dist` を直接 import しない。pdfjs エンジンへの依存は
 * 引数で受け取る `PageViewport` インスタンスのメソッド
 * (`convertToViewportPoint` / `convertToPdfPoint`) 経由のみで、`PageViewport`
 * は型としてのみ境界モジュール `@/lib/pdf/pdfjs` から import する。
 *
 * 注意（DPR）: キャンバスバッキングストアの device-pixel-ratio スケーリングは
 * 描画 composable（task 3.1）の責務であり、本モジュールの関心事ではない。本
 * モジュールは「viewport 倍率での CSS px」空間で動作する。
 */
import type { PageViewport } from '@/lib/pdf/pdfjs'

/** PDF 文書座標（左下原点・無倍率）。 */
export interface PdfPoint {
  x: number
  y: number
}

/** 表示レイヤ px（左上原点・倍率反映）。 */
export interface LayerPoint {
  left: number
  top: number
}

/** PDF 単位の矩形（左下原点。`x,y` は矩形の左下隅）。 */
export interface PdfRect {
  x: number
  y: number
  width: number
  height: number
}

/** 表示レイヤ px の矩形（左上原点・正の幅/高さ）。 */
export interface LayerRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * PDF 点（左下原点）→ 表示レイヤ点（左上原点）。
 * viewport が倍率・回転・Y 軸反転を内包する。
 */
export function toLayerPoint(vp: PageViewport, p: PdfPoint): LayerPoint {
  const [left, top] = vp.convertToViewportPoint(p.x, p.y)
  return { left, top }
}

/**
 * 表示レイヤ点（左上原点）→ PDF 点（左下原点）。
 * `toLayerPoint` の逆変換で、往復恒等 `toPdfPoint(vp, toLayerPoint(vp, p)) ≈ p`。
 */
export function toPdfPoint(vp: PageViewport, p: LayerPoint): PdfPoint {
  const [x, y] = vp.convertToPdfPoint(p.left, p.top)
  return { x, y }
}

/**
 * PDF 矩形（左下原点）→ 表示レイヤ矩形（左上原点・正の幅/高さ）。
 *
 * PDF 空間で対角の 2 隅（左下 `(x, y)` と右上 `(x+width, y+height)`）を viewport
 * で射影し、レイヤ空間で正規化する。Y 軸反転や回転により隅の順序が入れ替わって
 * も `min`/`abs` で吸収するため、結果は常に左上原点・正の幅/高さの軸並行ボックス
 * になる。
 */
export function toLayerRect(vp: PageViewport, r: PdfRect): LayerRect {
  const a = toLayerPoint(vp, { x: r.x, y: r.y })
  const b = toLayerPoint(vp, { x: r.x + r.width, y: r.y + r.height })
  const left = Math.min(a.left, b.left)
  const top = Math.min(a.top, b.top)
  const width = Math.abs(b.left - a.left)
  const height = Math.abs(b.top - a.top)
  return { left, top, width, height }
}
