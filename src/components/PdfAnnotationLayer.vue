<script setup lang="ts">
/**
 * リンク注釈層（内部相互参照／外部URL）— design.md「UI → PdfAnnotationLayer」/
 * 要件 9.1, 9.2, 9.3, 9.4。
 *
 * 単一ページのクリック可能なリンク注釈（内部 GoTo＝相互参照・外部 URL）を描画する
 * 3層スタックの注釈層。構築は `usePdfAnnotationLayer` に委譲し（v6 `AnnotationLayer`
 * クラス + --total-scale-factor 設定）、page / viewport の変化で再構築する。クリック
 * 結線は `usePdfLinkService`（内部 dest→requestGoToPage、外部 URL→新タブ）が担う。
 *
 * 境界規約（steering tech.md / structure.md「render 層は素の DOM」）:
 * - これは render 層コンポーネントであり Vuetify を一切使わない。
 * - `pdfjs-dist` を直接 import しない。`PageViewport` / `PDFPageProxy` は型としてのみ
 *   境界モジュール `@/lib/pdf/pdfjs` から受け取り、構築は composable 経由で pdfjs に
 *   到達する。
 *
 * 位置整合・pointer-events 分離（要件 9.4）: 注釈層は canvas / text 層と同一原点・
 * 同寸で重なる。層自体は `pointer-events:none` でテキスト選択（要件 2.3）を妨げず、
 * リンク要素（`.linkAnnotation > a`）のみ `pointer-events:auto` でクリックを受ける。
 * 公式 `.annotationLayer` CSS のリンク関連規則を `.annotation-layer` に移植する。
 */
import { onMounted, toRaw, useTemplateRef, watch } from 'vue'

import { usePdfAnnotationLayer } from '@/composables/usePdfAnnotationLayer'
import { usePdfLinkService } from '@/composables/usePdfLinkService'
import type { PageViewport, PDFPageProxy } from '@/lib/pdf/pdfjs'

export interface PdfAnnotationLayerProps {
  /** 描画対象ページ。 */
  page: PDFPageProxy
  /** 現在ページ・現在倍率の viewport。寸法とリンク配置の基準。 */
  viewport: PageViewport
}

const props = defineProps<PdfAnnotationLayerProps>()

const containerRef = useTemplateRef<HTMLDivElement>('container')

// 同一原点（左上 0,0）への重なりはインラインで宣言する（要件 9.4）。寸法は
// usePdfAnnotationLayer が viewport（--total-scale-factor）に合わせて
// container.style.{width,height} を設定するので、ここでは指定しない。
const layerStyle = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
}

// リンクサービス（IPDFLinkService 最小実装）。クリックで内部 dest→ジャンプ要求、
// 外部 URL→新タブ。ストアは各メソッド内で遅延解決するため setup 時に Pinia 不要。
const linkService = usePdfLinkService()
const { render } = usePdfAnnotationLayer()

function renderCurrent(): void {
  const container = containerRef.value
  if (container === null) return
  // pdfjs オブジェクトは toRaw で生のまま composable に渡す（reactive proxy だと
  // pdfjs 内部の WeakMap キー / this 束縛が崩れる。テキスト層と同様）。
  void render(
    container,
    toRaw(props.page),
    toRaw(props.viewport),
    linkService,
  ).catch(() => {
    // 未処理 Promise 拒否の保険。再構築は composable 側で冪等に行われる。
  })
}

onMounted(renderCurrent)

// page / viewport の変化で再構築（要件 9.1/9.4）。
watch(() => [props.page, props.viewport] as const, renderCurrent)
</script>

<template>
  <div ref="container" class="annotation-layer" :style="layerStyle" />
</template>

<!--
  非 scoped: pdfjs v6 AnnotationLayer が動的生成する <section>/<a>（リンク注釈）を
  確実に対象化するため。pdfjs 公式 pdf_viewer.css の .annotationLayer リンク関連
  規則を `.annotation-layer` に移植する。これが無いとリンクのヒット領域がページ画像と
  ズレ、また層全体がポインタを横取りして直下のテキスト選択（要件 2.3）を妨げる。
  --total-scale-factor は usePdfAnnotationLayer が viewport.scale に設定する。
-->
<style>
.annotation-layer {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  transform-origin: 0 0;
  /* setLayerDimensions の round() 用デフォルト（width/height を整数px化）。 */
  --scale-round-x: 1px;
  --scale-round-y: 1px;
}
/* 各リンク注釈の箱は絶対配置（pdfjs が rect から left/top/width/height を inline 設定）。
   箱自体はポインタを受け、リンク以外の領域は層の pointer-events:none を継承して通過する。 */
.annotation-layer :is(section, .linkAnnotation) {
  position: absolute;
  text-align: initial;
  pointer-events: auto;
  box-sizing: border-box;
  transform-origin: 0 0;
}
/* リンク注釈のアンカーは注釈箱全体を覆う透明なヒット領域（クリック可能・要件 9.1）。 */
.annotation-layer :is(.linkAnnotation, .buttonWidgetAnnotation.pushButton) > a {
  position: absolute;
  font-size: 1em;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  outline: none;
}
/* ホバー時に薄く可視化（公式と同等。視覚フィードバックのみ）。 */
.annotation-layer
  :is(.linkAnnotation, .buttonWidgetAnnotation.pushButton):not(.hasBorder)
  > a:hover {
  opacity: 0.2;
  background-color: rgb(255 255 0);
}
</style>
