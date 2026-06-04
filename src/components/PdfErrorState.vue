<script setup lang="ts">
/**
 * クローム・エラー / 初期案内表示（design.md「UI → PdfErrorState」/
 * 「Error Handling → Error Categories and Responses」/ 要件 7.3, 7.4, 7.5）。
 *
 * Vuetify 部品のみで構成し、**store を読み取るだけ**。二つの責務を持つ:
 * - `status === 'idle'`（エラーなし）: ファイルを開くよう促す初期案内（要件 7.5）。
 *   境界で示された通り、初期案内は本部品（PdfErrorState）が担う。
 * - `status === 'error'`: `error.kind` を利用者向けメッセージへ写像し `VAlert`
 *   （type=error）で提示（要件 7.3 破損 / 7.4 パスワード / 非PDF / 一般）。
 * - `loading`/`ready` のときは何も表示しない（ローディングは PdfLoadingState、
 *   表示中は本部品の出番なし）。
 *
 * 設計判断（境界の文言に従う）: idle 初期案内は本部品が所有する。ローディングは
 * 別部品 `PdfLoadingState` に分離する。
 *
 * Vuetify はアプリのクロームのみ（PDF 描画層では使わない）: steering tech.md。
 */
import { computed } from 'vue'

import { usePdfStore } from '@/stores/pdfStore'
import type { PdfErrorKind } from '@/types/pdf'

const store = usePdfStore()

/** エラー種別ごとの利用者向けメッセージ（日本語）。design.md「Error Categories」。 */
const ERROR_MESSAGES: Record<PdfErrorKind, { title: string; detail: string }> =
  {
    'invalid-type': {
      title: 'PDF 形式のファイルではありません',
      detail: 'PDF 形式のファイルを選択してください。',
    },
    corrupt: {
      title: 'PDF が破損しています',
      detail: 'ファイルが破損しているため読み込めませんでした。',
    },
    password: {
      title: 'パスワードで保護された PDF です',
      detail:
        'このファイルはパスワード保護されているため、現在は表示できません。',
    },
    unknown: {
      title: 'PDF を読み込めませんでした',
      detail: '予期しないエラーが発生しました。もう一度お試しください。',
    },
  }

/** idle（エラーなし）のとき初期案内を出す（要件 7.5）。 */
const showIdle = computed(
  () => store.status === 'idle' && store.error === null,
)

/** error のときエラー表示を出す。 */
const showError = computed(() => store.status === 'error')

/**
 * 表示するエラーメッセージ。`error` が null（種別不明）のときは `unknown` に
 * フォールバックする。
 */
const errorMessage = computed(
  () => ERROR_MESSAGES[store.error?.kind ?? 'unknown'],
)
</script>

<template>
  <div v-if="showIdle" data-test="idle-prompt" class="pdf-state-wrap">
    <v-empty-state
      icon="mdi-file-pdf-box"
      title="PDF ファイルを開いてください"
      text="ツールバーから、またはここにドラッグ＆ドロップして PDF を開きます。"
    />
  </div>

  <div v-else-if="showError" class="pdf-state-wrap">
    <v-alert
      data-test="error-alert"
      type="error"
      variant="tonal"
      :title="errorMessage.title"
      class="pdf-error-alert"
    >
      {{ errorMessage.detail }}
    </v-alert>
  </div>
</template>

<style scoped>
.pdf-state-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 8rem;
  padding: 1.5rem;
}
.pdf-error-alert {
  max-width: 32rem;
}
</style>
