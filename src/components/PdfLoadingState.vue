<script setup lang="ts">
/**
 * クローム・ローディング表示（design.md「UI → PdfLoadingState / PdfErrorState」/
 * 要件 7.1, 7.2）。
 *
 * Vuetify 部品のみで構成し、**store を読み取るだけ**（読み込みのトリガはしない）。
 * 表示の出し分け:
 * - `status === 'loading'` のときだけレンダリングする（内部 v-if でガード）。
 *   親が常時マウントしても安全なように、ここで状態判定を持つ（テストは本部品を
 *   直接 mount するためこの方式が明快）。
 * - 進捗 `loadProgress` が数値（0..1）なら確定 `VProgressLinear`（要件 7.2）。
 * - `loadProgress` が null なら不確定 `VProgressCircular`（要件 7.1）。
 *
 * Vuetify はアプリのクロームのみ（PDF 描画層では使わない）: steering tech.md。
 */
import { computed } from 'vue'

import { usePdfStore } from '@/stores/pdfStore'

const store = usePdfStore()

/** loading のときだけ表示する。 */
const visible = computed(() => store.status === 'loading')

/** 進捗が数値なら確定表示（要件 7.2）。null なら不確定スピナー（要件 7.1）。 */
const hasProgress = computed(() => typeof store.loadProgress === 'number')

/** 0..1 の進捗を 0..100 のパーセントへ写像（VProgressLinear の model-value）。 */
const progressPercent = computed(() =>
  Math.round((store.loadProgress ?? 0) * 100),
)
</script>

<template>
  <div
    v-if="visible"
    data-test="loading-state"
    class="pdf-loading-state d-flex flex-column align-center justify-center"
  >
    <template v-if="hasProgress">
      <v-progress-linear
        data-test="loading-progress"
        :model-value="progressPercent"
        color="primary"
        height="6"
        rounded
        class="loading-progress-bar"
      />
      <div class="loading-label mt-3">読み込み中… {{ progressPercent }}%</div>
    </template>
    <template v-else>
      <v-progress-circular
        data-test="loading-spinner"
        indeterminate
        color="primary"
        size="48"
      />
      <div class="loading-label mt-3">読み込み中…</div>
    </template>
  </div>
</template>

<style scoped>
.pdf-loading-state {
  width: 100%;
  height: 100%;
  min-height: 8rem;
  padding: 1.5rem;
  gap: 0.25rem;
}
.loading-progress-bar {
  width: 16rem;
  max-width: 80%;
}
.loading-label {
  font-variant-numeric: tabular-nums;
  opacity: 0.8;
}
</style>
