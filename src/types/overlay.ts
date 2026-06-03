/**
 * オーバーレイ層の型（**フェーズ1未使用・将来用の予約スタブ**）。
 *
 * design.md "Data Models" / requirement 8.4（フェーズ1ではオーバーレイ層に内容を
 * 表示しない＝拡張点・型のみを用意する）, steering structure.md「将来スライスは
 * 予約のみ」。本モジュールはアノテーション / レイアウト領域 / レイアウトグラフの
 * 「形」だけを確定させ、ストア・composable・コンポーネントは後続タスクで構築する。
 *
 * 座標方針（steering tech.md「座標系（拡張性の要）」）: 永続したい矩形は PDF 単位
 * （左下原点・無倍率）で保持する。矩形の形は座標 lib の `PdfRect` を**再利用**し、
 * ここで再定義しない（単一の矩形定義を保つ）。
 */
import type { PdfRect } from '@/lib/pdf/coordinates'

/** 注釈（ハイライト/メモ等）。`rect` は PDF 単位で保持する。 */
export interface Annotation {
  id: string
  page: number
  rect: PdfRect
  kind: string
  note?: string
}

/** レイアウト領域（図/表/段落等のラベル付き矩形）。`rect` は PDF 単位。 */
export interface LayoutRegion {
  id: string
  page: number
  rect: PdfRect
  label: string
}

/** レイアウトグラフのノード（1 領域に対応）。 */
export interface LayoutGraphNode {
  id: string
  region: LayoutRegion
}

/** レイアウトグラフのエッジ（領域間の関係）。 */
export interface LayoutGraphEdge {
  from: string
  to: string
  relation: string
}

/** ページ横断のレイアウト関係グラフ。 */
export interface LayoutGraph {
  nodes: LayoutGraphNode[]
  edges: LayoutGraphEdge[]
}
