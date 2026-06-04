<script setup lang="ts">
/**
 * サムネイル一覧（chrome）— design.md「UI → PdfSidebar / PdfThumbnail」/
 * 要件 5.3, 5.4。
 *
 * ドキュメント全ページのサムネイルを縮小描画して一覧化し、選択で該当ページへ
 * ジャンプ要求（`requestGoToPage`）を出す。現在ページ（`store.currentPage`）の
 * サムネイルをハイライトする。
 *
 * 仮想化（要件 5.3 の応答性）: 大規模 PDF で全ページのサムネイルを同時に描画しない
 * よう、固定アイテム高の**窓化リスト**で可視範囲（+ オーバースキャン）だけを実体化
 * する。Vuetify の `VVirtualScroll` は jsdom にレイアウト高さが無いと何も描画せず
 * テストが空になるため、ここでは自前の窓化に統一して観測可能性（可視窓に canvas が
 * 出ること）を担保する。一覧の総数は常に numPages（全ページが論理的に一覧化される）。
 *
 * 境界規約（steering tech.md / structure.md）:
 * - これは chrome コンポーネント。Vuetify を一覧コンテナに用いてよいが、`pdfjs-dist`
 *   を直接 import しない。`PDFPageProxy` 型は境界モジュール経由、描画は composable
 *   `usePdfPageRender` 経由でのみ pdfjs に到達する。
 * - pdfjs オブジェクト（PDFPageProxy）はリアクティブプロキシのまま composable に
 *   渡さない（内部 WeakMap / this 束縛の破壊を避ける）。`toRaw` で生のページを渡す。
 *   `store.doc` は markRaw 済み。
 */
import {
  computed,
  onBeforeUnmount,
  ref,
  toRaw,
  watch,
} from 'vue'

import { usePdfPageRender } from '@/composables/usePdfPageRender'
import type { PDFPageProxy } from '@/lib/pdf/pdfjs'
import { usePdfStore } from '@/stores/pdfStore'

/** サムネイルの目標横幅（CSS px）。ページ横幅からこの幅に合う倍率を算出する。 */
const THUMB_WIDTH = 120
/** ページ寸法取得前のフォールバック倍率（小倍率）。 */
const FALLBACK_SCALE = 0.2
/** ラベル等を含む 1 アイテムの固定高（窓化の幾何）。 */
const ITEM_HEIGHT = 200
/** 一覧コンテナの既定高さ（CSS px）。窓化の可視範囲算出に使う。 */
const VIEW_HEIGHT = 600
/** 可視範囲の上下に余分に描画する行数（スクロール時のちらつき防止）。 */
const OVERSCAN = 2

const store = usePdfStore()

// 一覧スクロールコンテナの参照とスクロール位置（窓化の入力）。
const listRef = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewHeight = ref(VIEW_HEIGHT)

/** 1..numPages の全ページ番号（論理的な一覧の総数）。 */
const pageNumbers = computed<number[]>(() => {
  const n = store.doc !== null ? store.numPages : 0
  return Array.from({ length: n }, (_, i) => i + 1)
})

// --- 窓化（固定アイテム高の単純な仮想スクロール） ---------------------------
const startIndex = computed(() =>
  Math.max(0, Math.floor(scrollTop.value / ITEM_HEIGHT) - OVERSCAN),
)
const endIndex = computed(() =>
  Math.min(
    pageNumbers.value.length,
    Math.ceil((scrollTop.value + viewHeight.value) / ITEM_HEIGHT) + OVERSCAN,
  ),
)
/** 実体化する可視窓のページ番号と、絶対配置のための先頭オフセット。 */
const visiblePages = computed<number[]>(() =>
  pageNumbers.value.slice(startIndex.value, endIndex.value),
)
/** スペーサー総高（全アイテム高の総和）。 */
const totalHeight = computed(() => pageNumbers.value.length * ITEM_HEIGHT)

function onScroll(): void {
  const el = listRef.value
  if (el === null) return
  scrollTop.value = el.scrollTop
  if (el.clientHeight > 0) viewHeight.value = el.clientHeight
}

/** アイテムの絶対 top 位置（窓化スペーサー内）。 */
function itemTop(pageNumber: number): number {
  return (pageNumber - 1) * ITEM_HEIGHT
}

// --- サムネイル描画 ---------------------------------------------------------
// 描画は composable に委譲（DPR 対応 + 前回 RenderTask キャンセル）。各サムネイルは
// 独立に再描画されうるため、ページ番号ごとの canvas を描画する。
const { render, cancel } = usePdfPageRender()
// 可視窓の canvas 要素（ページ番号 → 要素）。テンプレート ref（関数）で集める。
const canvasEls = new Map<number, HTMLCanvasElement>()

function setCanvasRef(pageNumber: number, el: Element | null): void {
  if (el instanceof HTMLCanvasElement) {
    canvasEls.set(pageNumber, el)
    void renderThumb(pageNumber, el)
  } else {
    canvasEls.delete(pageNumber)
  }
}

async function renderThumb(
  pageNumber: number,
  canvas: HTMLCanvasElement,
): Promise<void> {
  const doc = store.doc
  if (doc === null) return
  const page: PDFPageProxy = await doc.getPage(pageNumber)
  // 目標横幅に合う小倍率を算出（取得できなければフォールバック）。
  const baseWidth = page.getViewport({ scale: 1 }).width
  const scale = baseWidth > 0 ? THUMB_WIDTH / baseWidth : FALLBACK_SCALE
  // pdfjs オブジェクトは toRaw して composable に渡す（リアクティブ化を避ける）。
  await render(canvas, toRaw(page), scale).catch(() => {
    // ズーム/アンマウント時のキャンセルは composable 側で握り潰される。未処理
    // Promise 拒否を防ぐ保険。
  })
}

function selectPage(pageNumber: number): void {
  store.requestGoToPage(pageNumber)
}

// doc が差し替わったら窓位置をリセットし、可視窓を再描画する（古い canvas は
// アンマウントで Map から外れる）。
watch(
  () => store.doc,
  () => {
    scrollTop.value = 0
    if (listRef.value !== null) listRef.value.scrollTop = 0
  },
)

// アンマウントで in-flight 描画をキャンセル（要件 4.1 と同じ規律）。
onBeforeUnmount(() => {
  cancel()
})
</script>

<template>
  <div
    ref="listRef"
    class="pdf-thumbnail-list"
    data-test="thumbnail-list"
    :aria-label="`Thumbnails (${pageNumbers.length} pages)`"
    :data-total="pageNumbers.length"
    @scroll="onScroll"
  >
    <!-- 総高スペーサー: 全ページ分の高さを確保して窓化スクロールを成立させる。 -->
    <div class="pdf-thumbnail-spacer" :style="{ height: `${totalHeight}px` }">
      <div
        v-for="pageNumber in visiblePages"
        :key="pageNumber"
        class="pdf-thumbnail-item"
        :class="{ 'is-current': pageNumber === store.currentPage }"
        data-test="thumb-item"
        :style="{
          position: 'absolute',
          top: `${itemTop(pageNumber)}px`,
          left: '0',
          right: '0',
        }"
        role="button"
        tabindex="0"
        :aria-current="pageNumber === store.currentPage ? 'page' : undefined"
        @click="selectPage(pageNumber)"
        @keydown.enter="selectPage(pageNumber)"
        @keydown.space.prevent="selectPage(pageNumber)"
      >
        <div class="pdf-thumbnail-canvas-box">
          <canvas
            :ref="(el) => setCanvasRef(pageNumber, el as Element | null)"
            class="pdf-thumbnail-canvas"
          />
        </div>
        <span class="pdf-thumbnail-label" data-test="thumb-label">{{
          pageNumber
        }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pdf-thumbnail-list {
  position: relative;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
.pdf-thumbnail-spacer {
  position: relative;
  width: 100%;
}
.pdf-thumbnail-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 0;
  cursor: pointer;
  user-select: none;
  box-sizing: border-box;
}
.pdf-thumbnail-item.is-current {
  background-color: rgba(25, 118, 210, 0.12);
  outline: 2px solid rgb(25, 118, 210);
  outline-offset: -2px;
}
.pdf-thumbnail-canvas-box {
  display: flex;
  align-items: center;
  justify-content: center;
}
.pdf-thumbnail-canvas {
  max-width: 120px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  background: #fff;
}
.pdf-thumbnail-label {
  font-size: 12px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
</style>
