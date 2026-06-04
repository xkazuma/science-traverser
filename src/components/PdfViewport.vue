<script setup lang="ts">
/**
 * スクロール容器 + 仮想化ホスト — design.md「UI → PdfViewport」「ページジャンプ」/
 * 要件 2.1（連続スクロール描画）, 3.2（スクロール追従で現在ページ更新）,
 * 3.4（ジャンプで未描画ページへも正しく着地）。
 *
 * 役割:
 * - ドキュメント ready 時に各ページの固有寸法（PDF 単位 + 回転）を取得して
 *   `PageDimension[]` を構築し、`usePageVirtualizer` でプレースホルダ
 *   （全ページ分の高さ・累積 offsetTop）を確保する（2.1 / 6.2 の土台）。
 * - 総高スペーサーでスクロール総量を表現し、各プレースホルダを offsetTop に
 *   絶対配置する。可視ページ（`visiblePages`）のみ `PdfPage` を描画し、その要素を
 *   `observe()` して交差を観測させる。
 * - `pendingScrollTo` を監視し、設定時は `offsetOf(n)` の絶対位置へスクロール後
 *   `consumePendingScroll()` で消費する。未描画ページでも幾何由来で着地する（3.4）。
 * - 仮想化の `activePage` を監視し `setCurrentPage()` で現在ページに反映する（3.2）。
 * - `scale` 変化で `recompute(scale)` を呼びプレースホルダを再算出する（ズーム時）。
 * - フィット結線（4.3/4.4/4.5）: `fitMode` 変化・コンテナリサイズ（ResizeObserver）で
 *   `computeFitScale()` によりコンテナ幅基準のフィット倍率を算出し `store.setScale()`
 *   に反映する。`setScale` は `fitMode` を変えないため、フィット状態は維持される
 *   （手動 zoomIn/zoomOut のみ `fitMode='none'` に戻す）。算出後は既存の
 *   `watch(store.scale) → recompute` 連鎖がプレースホルダと PdfPage を更新する。
 *
 * 境界規約（steering tech.md / structure.md「render 層は素の DOM」）:
 * - これは render 層コンポーネントであり Vuetify を一切使わない。
 * - `pdfjs-dist` を直接 import しない。`PDFDocumentProxy` / `PDFPageProxy` は型として
 *   のみ境界モジュール `@/lib/pdf/pdfjs` から受け取り、ページ取得もストアの
 *   `doc`（markRaw 済み）経由で行う。
 * - pdfjs オブジェクト（PDFPageProxy）はリアクティブ Proxy 化すると内部が壊れるため
 *   `markRaw` で保持し、`getViewport` 等は素のオブジェクトに対して呼ぶ。
 */
import { markRaw, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'

import PdfPage from '@/components/PdfPage.vue'
import { computeFitScale } from '@/composables/useFitScale'
import {
  usePageVirtualizer,
  type PageDimension,
} from '@/composables/usePageVirtualizer'
import type { PDFPageProxy } from '@/lib/pdf/pdfjs'
import { usePdfStore } from '@/stores/pdfStore'

const store = usePdfStore()

// スクロール容器（ホスト）要素。ジャンプ時にここの scrollTop を直接動かす。
const host = ref<HTMLElement | null>(null)

// 取得済みページ寸法（仮想化の入力）。doc 切替で総入れ替えする。
const dimensions = ref<PageDimension[]>([])
// ページ番号 → markRaw 済み PDFPageProxy。可視ページの描画に再利用する
// （リアクティブ Proxy 化しないよう shallowRef + markRaw）。
const pages = shallowRef<Map<number, PDFPageProxy>>(new Map())

// 仮想化ホスト。dimensions（Ref）と現在倍率から placeholders / visiblePages /
// activePage / offsetOf を提供する。
const virtualizer = usePageVirtualizer(dimensions, store.scale)
const {
  placeholders,
  visiblePages,
  activePage,
  observe,
  releaseFar,
  offsetOf,
  recompute,
} = virtualizer

// 観測登録済みのプレースホルダ要素（重複 observe を避ける）。
const observed = new Set<number>()

/** 総高（最後のプレースホルダ底辺）。スクロール総量を表すスペーサー高に使う。 */
function totalHeight(): number {
  const ph = placeholders.value
  if (ph.length === 0) return 0
  const last = ph[ph.length - 1]
  return last.offsetTop + last.height
}

/** 可視判定（visiblePages に含まれ、かつページが取得済みなら描画する）。 */
function isVisible(pageNumber: number): boolean {
  return visiblePages.value.includes(pageNumber)
}

/** 取得済みページ proxy（無ければ undefined）。テンプレートから参照する。 */
function pageProxy(pageNumber: number): PDFPageProxy | undefined {
  return pages.value.get(pageNumber)
}

/**
 * ドキュメント ready 時に全ページの寸法を取得して仮想化入力を構築する。
 * 各ページの `getViewport({ scale: 1 })` から PDF 単位の幅・高さ・回転を読む。
 * 取得した PDFPageProxy は markRaw で再利用キャッシュへ格納する（描画用）。
 */
async function buildDimensions(): Promise<void> {
  const doc = store.doc
  const count = store.numPages
  observed.clear()
  if (doc === null || count <= 0) {
    dimensions.value = []
    pages.value = new Map()
    return
  }

  const nextDims: PageDimension[] = []
  const nextPages = new Map<number, PDFPageProxy>()
  for (let n = 1; n <= count; n += 1) {
    // ストアの doc は markRaw 済み。取得したページも markRaw で素のまま扱う。
    const page = markRaw(await doc.getPage(n))
    const vp = page.getViewport({ scale: 1 })
    nextDims.push({
      pageNumber: n,
      widthPdf: vp.width,
      heightPdf: vp.height,
      rotation: page.rotate,
    })
    nextPages.set(n, page)
  }

  // doc が途中で切り替わっていたら破棄（古い結果を反映しない）。
  if (store.doc !== doc) return
  pages.value = nextPages
  dimensions.value = nextDims
}

/**
 * プレースホルダ要素を観測対象に登録する（テンプレートの ref callback から呼ぶ）。
 * 同一ページの重複登録を避ける。
 */
function registerPlaceholder(
  pageNumber: number,
  el: Element | null,
): void {
  if (el === null || observed.has(pageNumber)) return
  observed.add(pageNumber)
  observe(el, pageNumber)
}

// ドキュメント / ページ数の変化で寸法を再構築する（読み込みフロー）。
watch(
  () => [store.doc, store.numPages] as const,
  () => {
    void buildDimensions()
  },
  { immediate: true },
)

// 倍率変化でプレースホルダを再算出する（ズーム時の高さ・offset 更新）。
// 描画自体は PdfPage の scale prop が追従する。
watch(
  () => store.scale,
  (scale) => {
    recompute(scale)
  },
)

/**
 * 現在のコンテナ内容領域サイズと取得済みページ寸法からフィット倍率を算出し、
 * `fitMode !== 'none'` のときのみ `store.setScale()` に反映する（4.3/4.4/4.5）。
 * コンテナ未マウントや寸法未取得・算出不能（computeFitScale が null）の場合は何もしない。
 */
function applyFitScale(): void {
  if (store.fitMode === 'none') return
  const el = host.value
  if (el === null || dimensions.value.length === 0) return
  const fit = computeFitScale(
    store.fitMode,
    { width: el.clientWidth, height: el.clientHeight },
    dimensions.value,
  )
  if (fit === null) return
  store.setScale(fit)
}

// フィットモード変化でフィット倍率を即時反映する（4.3 幅 / 4.4 ページ全体）。
// 'none' へ戻った場合は applyFitScale が早期 return し手動倍率を維持する。
watch(
  () => store.fitMode,
  () => {
    applyFitScale()
  },
)

// 寸法（doc 切替・全ページ寸法取得）確定時、フィット中なら再算出する。
watch(dimensions, () => {
  applyFitScale()
})

// コンテナサイズ変化（ウィンドウリサイズ等）でフィット倍率を再計算する（4.5）。
// jsdom/test 環境ではコンストラクタが制御可能 stub に差し替わる。
const resizeObserver = shallowRef<ResizeObserver | null>(null)

onMounted(() => {
  const el = host.value
  if (el === null || typeof ResizeObserver === 'undefined') return
  const ro = new ResizeObserver(() => {
    applyFitScale()
  })
  ro.observe(el)
  resizeObserver.value = ro
  // マウント直後の実寸でフィット中なら初期反映する。
  applyFitScale()
})

// ジャンプ要求の監視（3.4）。offsetOf(n) の絶対位置へスクロール後にクリアする。
// 未描画ページでも offsetOf がプレースホルダ由来の幾何で正しく着地する。
watch(
  () => store.pendingScrollTo,
  (target) => {
    if (target === null) return
    const el = host.value
    if (el !== null) {
      el.scrollTop = offsetOf(target)
    }
    store.consumePendingScroll()
  },
)

// スクロール追従（3.2）。最も可視なページを現在ページへ反映する。
watch(activePage, (page) => {
  store.setCurrentPage(page)
})

/**
 * 遠方ページのリソース解放（要件 6.4）。一度でも可視になった（=デコードされ得た）
 * ページ番号を `decodedPages` に記録し、可視ウィンドウから外れたページ
 * （`releaseFar()` が返す観測中・非可視ページ）の `PDFPageProxy.cleanup()` を呼んで
 * デコード済みリソースを明示解放する。far ページは v-if で PdfPage が unmount 済み
 * （canvas/text 描画はキャンセル済み）なので安全。proxy 自体は再利用可能で、
 * スクロール戻りで再デコードされる。記録から除外することで同一スクロール中の
 * 冗長な cleanup 呼び出しを避ける。
 */
const decodedPages = new Set<number>()
watch(visiblePages, (now) => {
  for (const n of now) decodedPages.add(n)
  const far = releaseFar()
  for (const n of far) {
    if (!decodedPages.has(n)) continue
    pages.value.get(n)?.cleanup()
    decodedPages.delete(n)
  }
})

onBeforeUnmount(() => {
  resizeObserver.value?.disconnect()
  resizeObserver.value = null
  virtualizer.destroy()
})
</script>

<template>
  <div
    ref="host"
    class="pdf-viewport"
    style="overflow: auto; position: relative"
  >
    <!-- 総高スペーサー: 全ページ分の高さを確保しスクロール総量を表現（2.1/6.2）。 -->
    <div
      class="pdf-spacer"
      :style="{ position: 'relative', height: `${totalHeight()}px` }"
    >
      <div
        v-for="ph in placeholders"
        :key="ph.pageNumber"
        :ref="(el) => registerPlaceholder(ph.pageNumber, el as Element | null)"
        class="pdf-placeholder"
        :style="{
          position: 'absolute',
          top: `${ph.offsetTop}px`,
          /*
           * 水平中央揃え（要件 2.5）。ページ幅が表示領域より狭いときは
           * (コンテナ幅 - ページ幅)/2 で左右余白を均等に中央寄せ、広いとき
           * （ズームイン）は 0 に張り付き従来どおり水平スクロールさせる。
           * 50% はスペーサー（=コンテナ内容幅）基準のためコンテナ幅にリアクティブ。
           */
          left: `max(0px, calc(50% - ${ph.width / 2}px))`,
          width: `${ph.width}px`,
          height: `${ph.height}px`,
        }"
      >
        <!-- 可視ページのみ 3 層スタックを描画。非可視は寸法だけ確保した空箱。 -->
        <PdfPage
          v-if="isVisible(ph.pageNumber) && pageProxy(ph.pageNumber)"
          :page="pageProxy(ph.pageNumber)!"
          :scale="store.scale"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * スクロール容器は bounded な高さを持たねば overflow:auto が内部スクロールを生まず、
 * スクロールが祖先（ウィンドウ/レイアウト）へ抜けてサイドバーと連動してしまう（要件 5.6）。
 * 親（DropZone）が height:100% 連鎖で bounded 高を渡すので、ここも height:100% で受けて
 * 内部スクロールを所有する。
 */
.pdf-viewport {
  height: 100%;
}
</style>
