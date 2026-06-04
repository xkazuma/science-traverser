/**
 * ビューア状態・ステータス・エラー種別の型（design.md "State Management"）。
 *
 * クライアント内の一時状態のみで永続化はない。`PdfState` は `pdfStore`（後続タスク）
 * が保持する単一状態の形を定義する。
 *
 * 境界規約（single pdfjs boundary / task 1.3 不変条件）: `PDFDocumentProxy` は
 * `pdfjs-dist` から直接ではなく、唯一の境界モジュール `@/lib/pdf/pdfjs` から
 * **型としてのみ** import する。オーバーレイ予約型は `@/types/overlay` から取り込む。
 */
import type { PDFDocumentProxy } from '@/lib/pdf/pdfjs'
import type { Annotation, LayoutRegion, LayoutGraph } from '@/types/overlay'

/** 読み込みライフサイクル: `idle → loading → ready | error`、`reset()` で `idle`。 */
export type PdfStatus = 'idle' | 'loading' | 'ready' | 'error'

/** フィットモード（要件 4.3-4.5）。`none` は手動倍率。 */
export type FitMode = 'none' | 'width' | 'page'

/** エラー分類（読み込み境界で早期に分類: 要件 7.3, 7.4）。 */
export type PdfErrorKind = 'invalid-type' | 'corrupt' | 'password' | 'unknown'

/** 分類済みエラー（`pdfStore.error` へ写像し `PdfErrorState` で表示）。 */
export interface PdfError {
  kind: PdfErrorKind
  message: string
}

/** ビューアの単一状態（`pdfStore`）。 */
export interface PdfState {
  source: ArrayBuffer | null
  doc: PDFDocumentProxy | null // markRaw 保持
  numPages: number
  currentPage: number // 1-origin（スクロール追従の結果）
  pendingScrollTo: number | null // ジャンプ要求（PdfViewport が消費しスクロール後 null 化）
  scale: number // 描画倍率
  fitMode: FitMode
  loadProgress: number | null // 0..1
  status: PdfStatus
  error: PdfError | null
  // 予約（フェーズ1未使用・型のみ。ページ番号キー）: requirement 8.4
  annotations: Record<number, Annotation[]>
  layoutRegions: Record<number, LayoutRegion[]>
  layoutGraph: LayoutGraph | null
}
