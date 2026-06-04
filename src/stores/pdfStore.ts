/**
 * 単一真実源ストア（design.md "State → pdfStore"）。
 *
 * doc/view 状態を集約する純粋な状態 + アクション。**このストアは pdfjs を呼ばない**
 * （実際の読み込みは composable `usePdfDocument` / task 2.4）。`load()` は状態遷移のみ。
 *
 * 状態機械: `idle → loading → ready | error`、`reset()` で `idle`（design.md 状態遷移）。
 *
 * 不変条件:
 * - 重い `PDFDocumentProxy` は `markRaw` で保持しディープリアクティブ化しない
 *   （steering tech.md / design.md "Key Decisions"）。`doc` を素のリアクティブ化すると
 *   pdfjs 内部構造まで Proxy 化され性能劣化するため。
 * - `currentPage`（スクロール追従の結果: 要件 3.2）と `pendingScrollTo`（ユーザーの
 *   ジャンプ要求）を分離する（design.md "ジャンプ結線"）。
 * - 倍率は常に `SCALE_MIN..SCALE_MAX` にクランプ（要件 4.2）。
 */
import { defineStore } from 'pinia'
import { markRaw, ref } from 'vue'

import type { PDFDocumentProxy } from '@/lib/pdf/pdfjs'
import type { FitMode, PdfError, PdfStatus } from '@/types/pdf'
import type { Annotation, LayoutGraph, LayoutRegion } from '@/types/overlay'

/** 倍率クランプ下限（要件 4.2、design.md「離散 0.5–4.0」）。 */
export const SCALE_MIN = 0.5
/** 倍率クランプ上限（要件 4.2、design.md「離散 0.5–4.0」）。 */
export const SCALE_MAX = 4.0
/** ズーム1段の乗算ファクタ。`zoomIn` は ×、`zoomOut` は ÷。 */
export const SCALE_STEP = 1.25
/** 初期倍率（無倍率= 等倍、クランプ範囲内）。 */
export const SCALE_DEFAULT = 1.0

/** 値を [min, max] に収める（純粋ヘルパ）。 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export const usePdfStore = defineStore('pdf', () => {
  // --- State（PdfState の形に対応） -----------------------------------------
  const source = ref<ArrayBuffer | null>(null)
  // markRaw 保持のため doc は ref<...> に格納するが、代入値を必ず markRaw する。
  const doc = ref<PDFDocumentProxy | null>(null)
  const numPages = ref(0)
  const currentPage = ref(1) // 1-origin（スクロール追従の結果: 要件 3.2）
  const pendingScrollTo = ref<number | null>(null) // ジャンプ要求
  const scale = ref(SCALE_DEFAULT)
  const fitMode = ref<FitMode>('none')
  const loadProgress = ref<number | null>(null) // 0..1
  const status = ref<PdfStatus>('idle')
  const error = ref<PdfError | null>(null)
  // 予約スライス（フェーズ1未使用・型のみ。ページ番号キー: 要件 8.4）。
  const annotations = ref<Record<number, Annotation[]>>({})
  const layoutRegions = ref<Record<number, LayoutRegion[]>>({})
  const layoutGraph = ref<LayoutGraph | null>(null)

  // --- Actions（design.md "Actions（契約）"） --------------------------------

  /**
   * 読み込み開始。状態を `loading` に遷移し source を保持、error/progress を初期化。
   * pdfjs は呼ばない（実読み込みは task 2.4）。
   */
  function load(src: ArrayBuffer): void {
    source.value = src
    status.value = 'loading'
    error.value = null
    loadProgress.value = null
    doc.value = null
    numPages.value = 0
    currentPage.value = 1
    pendingScrollTo.value = null
  }

  /**
   * 読み込み成功。`doc` を `markRaw` で保持（ディープリアクティブ化しない）、
   * `numPages` を確定し `ready` へ。現在ページは先頭にリセット。
   */
  function setReady(loadedDoc: PDFDocumentProxy, pages: number): void {
    doc.value = markRaw(loadedDoc)
    numPages.value = pages
    currentPage.value = 1
    pendingScrollTo.value = null
    status.value = 'ready'
    error.value = null
  }

  /** 読み込み失敗。`error` を保持し `error` 状態へ。 */
  function setError(err: PdfError): void {
    error.value = err
    status.value = 'error'
  }

  /** 進捗（0..1 もしくは未定の null）。 */
  function setProgress(p: number | null): void {
    loadProgress.value = p
  }

  /** 初期 `idle` 状態へ戻す（doc/source/error 等をクリア）。 */
  function reset(): void {
    source.value = null
    doc.value = null
    numPages.value = 0
    currentPage.value = 1
    pendingScrollTo.value = null
    scale.value = SCALE_DEFAULT
    fitMode.value = 'none'
    loadProgress.value = null
    status.value = 'idle'
    error.value = null
    annotations.value = {}
    layoutRegions.value = {}
    layoutGraph.value = null
  }

  /**
   * ジャンプ要求。範囲内（1..numPages）なら `pendingScrollTo` にセット、
   * 範囲外は**無視＝現状維持**（要件 3.5）。`currentPage` は動かさない
   * （スクロール結果は `setCurrentPage` で別途反映）。
   */
  function requestGoToPage(n: number): void {
    if (Number.isInteger(n) && n >= 1 && n <= numPages.value) {
      pendingScrollTo.value = n
    }
    // else: 範囲外は何もしない（現状維持）。
  }

  /** ビューポートがスクロール後に保留ジャンプをクリアする。 */
  function consumePendingScroll(): void {
    pendingScrollTo.value = null
  }

  /**
   * スクロール追従の現在ページ反映（要件 3.1/3.2）。範囲外は無視（現状維持）。
   */
  function setCurrentPage(n: number): void {
    if (Number.isInteger(n) && n >= 1 && n <= numPages.value) {
      currentPage.value = n
    }
  }

  /** 倍率を直接設定し [SCALE_MIN, SCALE_MAX] にクランプ（要件 4.2）。 */
  function setScale(n: number): void {
    scale.value = clamp(n, SCALE_MIN, SCALE_MAX)
  }

  /** 1段拡大し上限クランプ。手動倍率に切替（fitMode='none'）。 */
  function zoomIn(): void {
    scale.value = clamp(scale.value * SCALE_STEP, SCALE_MIN, SCALE_MAX)
    fitMode.value = 'none'
  }

  /** 1段縮小し下限クランプ。手動倍率に切替（fitMode='none'）。 */
  function zoomOut(): void {
    scale.value = clamp(scale.value / SCALE_STEP, SCALE_MIN, SCALE_MAX)
    fitMode.value = 'none'
  }

  /** フィットモード設定（要件 4.3-4.5）。 */
  function setFitMode(mode: FitMode): void {
    fitMode.value = mode
  }

  return {
    // state
    source,
    doc,
    numPages,
    currentPage,
    pendingScrollTo,
    scale,
    fitMode,
    loadProgress,
    status,
    error,
    annotations,
    layoutRegions,
    layoutGraph,
    // actions
    load,
    setReady,
    setError,
    setProgress,
    reset,
    requestGoToPage,
    consumePendingScroll,
    setCurrentPage,
    setScale,
    zoomIn,
    zoomOut,
    setFitMode,
  }
})
