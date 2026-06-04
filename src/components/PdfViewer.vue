<script setup lang="ts">
/**
 * ルート画面オーケストレータ（design.md「UI → PdfViewer」/ 要件 2.1, 7.5）。
 *
 * 役割（INTEGRATION）: 既存のクローム/描画コンポーネントを `<v-app>` 配下の
 * Vuetify レイアウトに結線し、`store.status` に応じて主コンテンツを出し分ける。
 * 子コンポーネントの内部は変更せず、配線とライフサイクルのみを所有する。
 *
 * 結線:
 * - `PdfToolbar @open` → 隠しファイル入力の `click()`（要件 1.1 のトリガ）。
 *   入力の `change` で `useFileIntake().fromInput` を呼び、PDF なら
 *   `usePdfDocument().open(buffer)`、非PDF なら DropZone と同様に
 *   `store.setError({ kind: 'invalid-type' })`。
 * - `PdfDropZone @file` → 検証済み ArrayBuffer を `open(buffer)` に渡す
 *   （要件 1.2 ドロップで読み込み開始）。DropZone が全面を包むため、どこへ
 *   ドロップしても読み込みが始まる。
 *
 * status 駆動の主コンテンツ（要件 7.5 / 2.1）— 単一コンテンツ領域を `v-if` で
 * 明示的に出し分ける（PdfLoadingState/PdfErrorState は内部でも自己ガードするが、
 * ここでも status で切り替えることで「各状態で正しい一つが出る」を保証する）:
 * - idle  → PdfErrorState（初期案内）
 * - loading → PdfLoadingState
 * - error → PdfErrorState（エラー表示）
 * - ready → PdfViewport（+ PdfSidebar ドロワー）
 *
 * ライフサイクル: 単一の `usePdfDocument()` インスタンスで open/close を担い、
 * アンマウント時に `close()` でドキュメントを破棄する。
 *
 * 境界規約（steering tech.md）: PdfViewer は chrome のオーケストレータ。Vuetify を
 * 用いてよいが pdfjs-dist は直接 import せず、読み込みは composable 経由で行う。
 */
import { computed, onBeforeUnmount, ref } from 'vue'

import PdfDropZone from '@/components/PdfDropZone.vue'
import PdfErrorState from '@/components/PdfErrorState.vue'
import PdfLoadingState from '@/components/PdfLoadingState.vue'
import PdfSidebar from '@/components/PdfSidebar.vue'
import PdfToolbar from '@/components/PdfToolbar.vue'
import PdfViewport from '@/components/PdfViewport.vue'
import { useFileIntake } from '@/composables/useFileIntake'
import { usePdfDocument } from '@/composables/usePdfDocument'
import { usePdfStore } from '@/stores/pdfStore'

const store = usePdfStore()
const intake = useFileIntake()
// open/close ライフサイクルは単一インスタンスで一貫させる（破棄に必要）。
const pdfDocument = usePdfDocument()

/** 隠しファイル入力。Toolbar の open で click() してピッカーを開く。 */
const fileInput = ref<HTMLInputElement | null>(null)

/** ドキュメントが ready のときだけサイドバー（ドロワー）を出す。 */
const showSidebar = computed(() => store.status === 'ready')

/** Toolbar `open`: 隠しファイル入力を開く（要件 1.1）。 */
function openFilePicker(): void {
  fileInput.value?.click()
}

/** 検証済み ArrayBuffer を読み込みに渡す（共通パス）。 */
function load(buffer: ArrayBuffer): void {
  void pdfDocument.open(buffer)
}

/** DropZone `file`: 既に検証済みの ArrayBuffer をそのまま読み込む（要件 1.2）。 */
function onDropped(buffer: ArrayBuffer): void {
  load(buffer)
}

/**
 * ファイル入力の change: 選択ファイルを検証し、PDF なら読み込み、非PDF なら
 * DropZone と同じく invalid-type エラーを提示する（要件 1.1 / 1.4）。
 * 同じファイルを連続選択しても change が発火するよう、処理後に value を空にする。
 */
async function onFileSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const result = await intake.fromInput(input.files)
  if (result.ok) {
    load(result.buffer)
  } else {
    store.setError({
      kind: 'invalid-type',
      message: 'PDF 形式のファイルではありません',
    })
  }
  input.value = ''
}

onBeforeUnmount(() => {
  pdfDocument.close()
})
</script>

<template>
  <v-layout class="pdf-viewer" full-height>
    <!-- クローム・ツールバー（上部）。open で隠しファイル入力を開く。 -->
    <v-app-bar density="compact" flat>
      <PdfToolbar @open="openFilePicker" />
    </v-app-bar>

    <!-- ready のときだけアウトライン/サムネイルのドロワーを出す。 -->
    <PdfSidebar v-if="showSidebar" />

    <!-- 隠しファイル入力（ピッカー経由の読み込み: 要件 1.1）。 -->
    <input
      ref="fileInput"
      type="file"
      accept="application/pdf"
      data-test="file-input"
      hidden
      @change="onFileSelected"
    />

    <v-main class="pdf-viewer__main">
      <!-- 全面 D&D ラッパ。どこにドロップしても読み込みが始まる（要件 1.2）。 -->
      <PdfDropZone class="pdf-viewer__dropzone" @file="onDropped">
        <!-- status 駆動の単一コンテンツ領域（要件 7.5 / 2.1）。 -->
        <PdfViewport v-if="store.status === 'ready'" />
        <PdfLoadingState v-else-if="store.status === 'loading'" />
        <PdfErrorState v-else />
      </PdfDropZone>
    </v-main>
  </v-layout>
</template>

<style scoped>
.pdf-viewer__main {
  height: 100%;
}
.pdf-viewer__dropzone {
  height: 100%;
}
</style>
