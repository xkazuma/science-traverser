<script setup lang="ts">
/**
 * ページ3層スタック — design.md「ページ3層スタック」/ 要件 2.1, 2.4。
 *
 * 1 ページを「キャンバス層（ラスタ）＋テキスト層（選択可能）＋オーバーレイ層
 * （拡張点）」の 3 層で、同一原点（左上 0,0）に重ねて表示する。ルートの
 * `.pdf-page` は `position: relative` で viewport 寸法（CSS px）の箱になり、内側の
 * 3 層はすべて絶対配置で原点を共有する。倍率変化時は viewport を再算出し全層が
 * 同一 viewport を追従するため、テキスト層・オーバーレイ層がページ画像と位置整合
 * を保つ（要件 2.4）。
 *
 * 境界規約（steering tech.md / structure.md「render 層は素の DOM」）:
 * - これは render 層コンポーネントであり Vuetify を一切使わない。
 * - `pdfjs-dist` を直接 import しない。`PDFPageProxy` は型としてのみ境界モジュール
 *   `@/lib/pdf/pdfjs` から受け取り、描画は子層の composable 経由で pdfjs に到達する。
 */
import { computed } from 'vue'

import PdfCanvasLayer from '@/components/PdfCanvasLayer.vue'
import PdfOverlayLayer from '@/components/PdfOverlayLayer.vue'
import PdfTextLayer from '@/components/PdfTextLayer.vue'
import type { PDFPageProxy } from '@/lib/pdf/pdfjs'

export interface PdfPageProps {
  /** 描画対象ページ。 */
  page: PDFPageProxy
  /** 現在倍率。変化で viewport を再算出し全層が追従する（要件 2.4）。 */
  scale: number
}

const props = defineProps<PdfPageProps>()

// 現在倍率の viewport。scale に反応する computed なので、倍率変更で 3 層すべてが
// 同一 viewport（同寸・同原点）を追従する（要件 2.4）。
const viewport = computed(() => props.page.getViewport({ scale: props.scale }))

// ルート箱は viewport 寸法（CSS px）。子の 3 層は absolute でこの箱の原点に重なる。
const pageStyle = computed(() => ({
  position: 'relative' as const,
  width: `${viewport.value.width}px`,
  height: `${viewport.value.height}px`,
}))
</script>

<template>
  <div class="pdf-page" :style="pageStyle">
    <!-- 描画順（背面→前面）: キャンバス → テキスト → オーバーレイ。全層が同一原点。 -->
    <PdfCanvasLayer :page="props.page" :scale="props.scale" />
    <PdfTextLayer :page="props.page" :viewport="viewport" />
    <PdfOverlayLayer :viewport="viewport" />
  </div>
</template>
