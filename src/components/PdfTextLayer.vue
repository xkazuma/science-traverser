<script setup lang="ts">
/**
 * テキスト層（選択可能テキスト）— design.md「UI → PdfTextLayer」/ 要件 2.3, 2.4。
 *
 * 単一ページの選択・コピー可能なテキストオーバーレイを構築する 3 層スタックの
 * 中間層。構築は `usePdfTextLayer` に委譲し（v6 `TextLayer` クラス + --scale-factor
 * 設定）、page / viewport の変化で再構築、アンマウントで in-flight をキャンセルする。
 *
 * 境界規約（steering tech.md / structure.md「render 層は素の DOM」）:
 * - これは render 層コンポーネントであり Vuetify を一切使わない。
 * - `pdfjs-dist` を直接 import しない。`PageViewport` / `PDFPageProxy` は型としてのみ
 *   境界モジュール `@/lib/pdf/pdfjs` から受け取り、構築は composable 経由で pdfjs に
 *   到達する。
 *
 * 位置決め（要件 2.4）: テキスト層は canvas と同一原点・同寸（design.md L382）。
 * 絶対配置・原点 0,0 で canvas に重なり、不可視・選択可能なグリフが描画画像に整合する。
 */
import { onBeforeUnmount, onMounted, toRaw, useTemplateRef, watch } from 'vue'

import { usePdfTextLayer } from '@/composables/usePdfTextLayer'
import type { PageViewport, PDFPageProxy } from '@/lib/pdf/pdfjs'

export interface PdfTextLayerProps {
  /** 描画対象ページ。 */
  page: PDFPageProxy
  /** 現在ページ・現在倍率の viewport。寸法とグリフ配置の基準。 */
  viewport: PageViewport
}

const props = defineProps<PdfTextLayerProps>()

const containerRef = useTemplateRef<HTMLDivElement>('container')

// 同一原点（左上 0,0）への重なりはインラインで宣言する（要件 2.4）。
// 寸法は usePdfTextLayer が viewport（--total-scale-factor）に合わせて
// container.style.{width,height} を設定するので、ここでは指定しない。
const layerStyle = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
}

// テキスト層状態（live TextLayer）は composable 内に保持される（design.md L108）。
const { render, cancel } = usePdfTextLayer()

function renderCurrent(): void {
  const container = containerRef.value
  if (container === null) return
  // pdfjs オブジェクト（PDFPageProxy / PageViewport）を Vue のリアクティブプロキシ
  // のまま渡すと、pdfjs 内部の WeakMap キーや this 束縛が崩れて TextLayer.render
  // が空になる。toRaw で生のオブジェクトを composable に渡す。
  void render(container, toRaw(props.page), toRaw(props.viewport)).catch(() => {
    // 未処理 Promise 拒否の保険。再構築は composable 側で冪等に行われる。
  })
}

onMounted(renderCurrent)

// page / viewport の変化で再構築（要件 2.3/2.4）。
watch(
  () => [props.page, props.viewport] as const,
  renderCurrent,
)

// アンマウントで in-flight 構築をキャンセル。
onBeforeUnmount(() => {
  cancel()
})
</script>

<template>
  <div ref="container" class="text-layer" :style="layerStyle" />
</template>
