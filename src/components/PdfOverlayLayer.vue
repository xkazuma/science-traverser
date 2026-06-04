<script setup lang="ts">
/**
 * 空のオーバーレイ層（拡張点）— design.md "UI → PdfOverlayLayer（拡張点・要件 8）",
 * requirements 8.1–8.4。
 *
 * キャンバス層 / テキスト層と同一原点（左上 0,0）に重なり、viewport 寸法に一致
 * する箱を提供する。フェーズ1では内容を描かず（8.4）、スコープ付きスロットで
 * 座標契約（viewport + 相互変換関数）を公開するだけの拡張点である。
 *
 * 境界規約（steering tech.md / structure.md「render 層は素の DOM」）:
 * - これは render 層コンポーネントであり Vuetify を一切使わない（viewport 座標で
 *   の精密配置のため Material 部品を挟まない）。
 * - `pdfjs-dist` を直接 import しない。`PageViewport` は型としてのみ境界モジュール
 *   `@/lib/pdf/pdfjs` から受け取り、座標変換は純粋関数 `@/lib/pdf/coordinates`
 *   に委譲する。
 *
 * 倍率変化への追従（8.3）: 寸法・変換関数はいずれも `props.viewport` から算出する
 * computed なので、親が倍率変更で新しい viewport を差し替えると箱と変換が同時に
 * 更新される。永続値（PDF 単位）は不変のまま viewport 差し替えだけで吸収される。
 */
import { computed } from 'vue'

import {
  toLayerPoint,
  toPdfPoint,
  toLayerRect,
} from '@/lib/pdf/coordinates'
import type { PdfPoint, LayerPoint, PdfRect } from '@/lib/pdf/coordinates'
import type { PageViewport } from '@/lib/pdf/pdfjs'

export interface PdfOverlayLayerProps {
  /** 現在ページ・現在倍率の viewport。寸法と座標変換の基準。 */
  viewport: PageViewport
}

/** スコープ付きスロットで公開する契約（フェーズ1では子なし）。 */
export interface PdfOverlaySlotProps {
  viewport: PageViewport
  toLayer: (p: PdfPoint) => LayerPoint
  toPdf: (p: LayerPoint) => PdfPoint
  toLayerRect: (r: PdfRect) => {
    left: number
    top: number
    width: number
    height: number
  }
}

const props = defineProps<PdfOverlayLayerProps>()

defineSlots<{
  /** 拡張点。フェーズ1では未提供（層は空）。 */
  default?(props: PdfOverlaySlotProps): unknown
}>()

// 層の箱は viewport 寸法（CSS px）に一致し、同一原点（0,0）に重なる（8.1）。
// viewport プロップに反応する computed なので倍率変化で更新される（8.3）。
// pointer-events:none — 最前面の空オーバーレイ層がポインタ操作を横取りして直下の
// テキスト層の選択（要件 2.3）を妨げないよう、イベントを通過させる。将来の対話的な
// 子要素（注釈等）は自身に pointer-events:auto を設定して個別に有効化する。
const layerStyle = computed(() => ({
  position: 'absolute' as const,
  inset: 0,
  width: `${props.viewport.width}px`,
  height: `${props.viewport.height}px`,
  pointerEvents: 'none' as const,
}))

// 現在の viewport にバインドした変換関数。viewport 差し替えで再生成される（8.3）。
const toLayer = computed(
  () => (p: PdfPoint): LayerPoint => toLayerPoint(props.viewport, p),
)
const toPdf = computed(
  () => (p: LayerPoint): PdfPoint => toPdfPoint(props.viewport, p),
)
const toLayerRectBound = computed(
  () =>
    (r: PdfRect): { left: number; top: number; width: number; height: number } =>
      toLayerRect(props.viewport, r),
)
</script>

<template>
  <div class="overlay-layer" :style="layerStyle">
    <!--
      フェーズ1は内容を描かない（8.4）。スロット未提供なら空のまま。
      スコープ付きスロットで座標契約を公開するのみ（拡張点）。
    -->
    <slot
      :viewport="props.viewport"
      :to-layer="toLayer"
      :to-pdf="toPdf"
      :to-layer-rect="toLayerRectBound"
    />
  </div>
</template>
