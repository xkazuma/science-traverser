<script setup lang="ts">
/**
 * キャンバス層（ラスタ描画）— design.md「UI → PdfCanvasLayer」/ 要件 2.2, 2.4。
 *
 * 単一ページを `<canvas>` にラスタ描画する 3 層スタックの最下層。描画は
 * `usePdfPageRender` に委譲し（DPR 対応 + 前回 RenderTask キャンセル）、page /
 * scale の変化で再描画、アンマウントで in-flight 描画をキャンセルする。
 *
 * 境界規約（steering tech.md / structure.md「render 層は素の DOM」）:
 * - これは render 層コンポーネントであり Vuetify を一切使わない。
 * - `pdfjs-dist` を直接 import しない。`PDFPageProxy` は型としてのみ境界モジュール
 *   `@/lib/pdf/pdfjs` から受け取り、描画は composable 経由でのみ pdfjs に到達する。
 *
 * 位置決め（要件 2.4）: canvas は絶対配置・原点 0,0。テキスト層 / オーバーレイ層と
 * 同一原点に重なる。CSS 寸法は composable が viewport（= scale）に合わせて設定する。
 */
import { onBeforeUnmount, onMounted, toRaw, useTemplateRef, watch } from 'vue'

import { usePdfPageRender } from '@/composables/usePdfPageRender'
import type { PDFPageProxy } from '@/lib/pdf/pdfjs'

export interface PdfCanvasLayerProps {
  /** 描画対象ページ。 */
  page: PDFPageProxy
  /** 現在倍率。変化で再描画する。 */
  scale: number
}

const props = defineProps<PdfCanvasLayerProps>()

const canvasRef = useTemplateRef<HTMLCanvasElement>('canvas')

// 同一原点（左上 0,0）への重なりはインラインで宣言する（要件 2.4）。
// PdfOverlayLayer と同様にインライン absolute にして、scoped CSS のカスケードに
// 依存せず層の整合をテスト可能（observable）にする。寸法は composable が viewport
// に合わせて canvas.style.{width,height} を設定するので、ここでは指定しない。
const layerStyle = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
}

// ページ描画状態（live RenderTask）は composable 内に保持される（design.md L108）。
const { render, cancel } = usePdfPageRender()

function renderCurrent(): void {
  const canvas = canvasRef.value
  if (canvas === null) return
  // cancel は composable 側で前回 in-flight を畳む。RenderingCancelledException は
  // 通常フローとして握り潰されるので、ここで catch して握り潰すだけで十分。
  // pdfjs の PDFPageProxy はリアクティブプロキシのまま渡さない（内部 WeakMap /
  // this 束縛の破壊を避ける）。toRaw で生のページを composable に渡す。
  void render(canvas, toRaw(props.page), props.scale).catch(() => {
    // 実エラーは composable が re-throw するが、ズーム連打時のキャンセルは
    // 既に握り潰されている。ここでの catch は未処理 Promise 拒否を防ぐ保険。
  })
}

onMounted(renderCurrent)

// page / scale の変化で再描画（要件 2.2/2.4）。
watch(
  () => [props.page, props.scale] as const,
  renderCurrent,
)

// アンマウントで in-flight 描画をキャンセル（要件 4.1）。
onBeforeUnmount(() => {
  cancel()
})
</script>

<template>
  <canvas ref="canvas" class="canvas-layer" :style="layerStyle" />
</template>
