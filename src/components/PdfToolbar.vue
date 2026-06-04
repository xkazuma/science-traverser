<script setup lang="ts">
/**
 * クローム・ツールバー（design.md「UI → その他 UI → PdfToolbar」/
 * 要件 3.1, 3.3, 3.4, 4.1, 4.3, 4.4）。
 *
 * Vuetify 部品のみで構成し、**ロジックを持たない**。すべての操作は pdfStore の
 * action を dispatch するか、`open` を emit するだけ。境界の不変条件:
 * - ジャンプの範囲検証は store（`requestGoToPage` が範囲外を無視）に委譲し、
 *   ここでは二重に検証しない。blur で入力欄を `currentPage` に戻すのみ。
 * - フィットは `setFitMode` でモードを設定するだけ。実描画倍率の算出は task 5.2。
 * - 倍率は `zoomIn/zoomOut` がクランプするため、ここでは境界でボタンを無効化する
 *   のみ（操作の発火は常に store に委ねる）。
 *
 * Vuetify はアプリのクロームのみ（PDF 描画層では使わない）: steering tech.md。
 */
import { computed, ref, watch } from 'vue'

import { SCALE_MAX, SCALE_MIN, usePdfStore } from '@/stores/pdfStore'

defineEmits<{ open: [] }>()

const store = usePdfStore()

/** ドキュメント未読込ならページ/ズーム/フィット操作を一括で無効化する。 */
const controlsDisabled = computed(() => store.status !== 'ready')

const prevDisabled = computed(
  () => controlsDisabled.value || store.currentPage <= 1,
)
const nextDisabled = computed(
  () => controlsDisabled.value || store.currentPage >= store.numPages,
)
const zoomOutDisabled = computed(
  () => controlsDisabled.value || store.scale <= SCALE_MIN,
)
const zoomInDisabled = computed(
  () => controlsDisabled.value || store.scale >= SCALE_MAX,
)

/** 現在倍率の表示（%）。 */
const scalePercent = computed(() => `${Math.round(store.scale * 100)}%`)

/**
 * フィットトグルのモデル。VBtnToggle に紐づけ、選択を store.fitMode に反映する。
 * `none`（手動倍率）のときは未選択（null）にする。
 */
const fitModel = computed<'width' | 'page' | null>({
  get: () => (store.fitMode === 'none' ? null : store.fitMode),
  set: (mode) => {
    store.setFitMode(mode ?? 'none')
  },
})

/**
 * ジャンプ入力に表示する現在ページ（文字列）。
 * 未読込（numPages === 0）のときは "0" を表示し、アイドル時に "0 / 0" となる
 * ようにする（要件 3.6）。読込後は currentPage を表示する。
 */
function displayPage(): string {
  return store.numPages === 0 ? '0' : String(store.currentPage)
}

/** ジャンプ入力のローカルモデル（文字列）。currentPage / numPages に追従させる。 */
const pageInput = ref(displayPage())
watch(
  () => [store.currentPage, store.numPages] as const,
  () => {
    pageInput.value = displayPage()
  },
)

/** 入力確定: 整数化して store に委譲（範囲外は store が無視）。 */
function commitJump(): void {
  const n = Number.parseInt(pageInput.value, 10)
  if (Number.isInteger(n)) {
    store.requestGoToPage(n)
  }
}

/** blur 時に表示を現在ページへ戻す（無効・範囲外入力をクリア）。 */
function resetJump(): void {
  pageInput.value = String(store.currentPage)
}

function goPrev(): void {
  store.requestGoToPage(store.currentPage - 1)
}
function goNext(): void {
  store.requestGoToPage(store.currentPage + 1)
}
</script>

<template>
  <v-toolbar density="compact" class="pdf-toolbar">
    <v-btn
      data-test="open"
      icon="mdi-folder-open"
      variant="text"
      @click="$emit('open')"
    >
      <v-icon icon="mdi-folder-open" />
      <v-tooltip activator="parent" location="bottom" text="Open PDF" />
    </v-btn>

    <v-divider vertical class="mx-1" />

    <v-btn
      data-test="prev-page"
      icon="mdi-chevron-left"
      variant="text"
      :disabled="prevDisabled"
      @click="goPrev"
    >
      <v-icon icon="mdi-chevron-left" />
      <v-tooltip activator="parent" location="bottom" text="Previous page" />
    </v-btn>

    <div class="page-indicator d-flex align-center">
      <v-text-field
        data-test="page-jump"
        v-model="pageInput"
        type="number"
        variant="outlined"
        density="compact"
        hide-details
        single-line
        :disabled="controlsDisabled"
        class="page-jump-field"
        @keydown.enter="commitJump"
        @blur="resetJump"
      />
      <span class="page-total mx-1" data-test="page-total"
        >/ {{ store.numPages }}</span
      >
    </div>

    <v-btn
      data-test="next-page"
      icon="mdi-chevron-right"
      variant="text"
      :disabled="nextDisabled"
      @click="goNext"
    >
      <v-icon icon="mdi-chevron-right" />
      <v-tooltip activator="parent" location="bottom" text="Next page" />
    </v-btn>

    <v-divider vertical class="mx-1" />

    <v-btn
      data-test="zoom-out"
      icon="mdi-magnify-minus"
      variant="text"
      :disabled="zoomOutDisabled"
      @click="store.zoomOut()"
    >
      <v-icon icon="mdi-magnify-minus" />
      <v-tooltip activator="parent" location="bottom" text="Zoom out" />
    </v-btn>

    <span class="scale-percent" data-test="scale-percent">{{
      scalePercent
    }}</span>

    <v-btn
      data-test="zoom-in"
      icon="mdi-magnify-plus"
      variant="text"
      :disabled="zoomInDisabled"
      @click="store.zoomIn()"
    >
      <v-icon icon="mdi-magnify-plus" />
      <v-tooltip activator="parent" location="bottom" text="Zoom in" />
    </v-btn>

    <v-divider vertical class="mx-1" />

    <v-btn-toggle
      v-model="fitModel"
      density="compact"
      variant="outlined"
      :disabled="controlsDisabled"
    >
      <v-btn data-test="fit-width" value="width" icon="mdi-arrow-expand-horizontal">
        <v-icon icon="mdi-arrow-expand-horizontal" />
        <v-tooltip activator="parent" location="bottom" text="Fit width" />
      </v-btn>
      <v-btn data-test="fit-page" value="page" icon="mdi-fit-to-page-outline">
        <v-icon icon="mdi-fit-to-page-outline" />
        <v-tooltip activator="parent" location="bottom" text="Fit page" />
      </v-btn>
    </v-btn-toggle>
  </v-toolbar>
</template>

<style scoped>
.page-jump-field {
  width: 4.5rem;
}
.page-total {
  white-space: nowrap;
}
.scale-percent {
  min-width: 3rem;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
</style>
