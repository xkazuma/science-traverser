<script setup lang="ts">
/**
 * クローム部品 PdfDropZone — 全面ドラッグ&ドロップ領域（design.md「UI → PdfDropZone」/
 * 要件 1.2 ドロップで読み込み開始 / 1.3 ドラッグ中の視覚的フィードバック）。
 *
 * 責務:
 * - 既定スロットでアプリ内容を内包する全面ラッパ（親はこれをアプリ全体に被せる）。
 * - ドラッグ中（dragenter/dragover）に Vuetify `VOverlay` で視覚FBを出す（要件 1.3）。
 * - ドロップ時に `useFileIntake().fromDrop(event)` で検証 + ArrayBuffer 化（要件 1.2）。
 *
 * 設計判断（emit ベースの疎結合）: ドロップ成功時はストアに読み込ませず、ArrayBuffer を
 * `file` イベントとして emit するだけにする。実際の読み込みオーケストレーション
 * （pdfjs / usePdfDocument の起動）はビューア結線 task 5.1 が `file` を受けて行う。
 * これにより DropZone は pdfjs から疎結合のまま「ドロップ → 読み込みが始まる」を満たす
 * （境界: pdfjs/usePdfDocument を直接呼ばない、ビューア結線も持たない）。
 * 一方、非PDF（invalid-type）は表示要件 1.4 近傍として即座にストアの `setError` で
 * 利用者に提示する（PdfErrorState が `error.kind` を読み出して表示）。
 *
 * フリッカ対策: 子要素をまたぐ dragenter/dragleave は要素ごとに発火し FB が点滅する。
 * enter/leave のカウンタで「全面領域から完全に離れた」ときのみ FB を畳む。
 *
 * 視覚FB（VOverlay）は `contained` + `attach` で本部品内に描画し、全面ラッパに重ねる。
 * Vuetify はクロームのみ（描画層では使わない）: steering tech.md。
 */
import { ref } from 'vue'

import { useFileIntake } from '@/composables/useFileIntake'
import { usePdfStore } from '@/stores/pdfStore'

const emit = defineEmits<{ file: [ArrayBuffer] }>()

const store = usePdfStore()
const intake = useFileIntake()

/** 全面ラッパ要素。VOverlay の `attach` 先（本部品内に重ねるため）。 */
const root = ref<HTMLElement | null>(null)

/** ドラッグ中フラグ（VOverlay の表示制御 = 視覚FB: 要件 1.3）。 */
const isDragging = ref(false)

/**
 * dragenter/dragleave の入れ子カウンタ。子要素間の遷移で leave→enter が連続発火
 * しても、カウンタが 0 になるまで FB を維持してフリッカを防ぐ。
 */
let dragDepth = 0

/** dragenter: 深さを増やし FB を表示。preventDefault でドロップ可能を示す。 */
function onDragEnter(event: DragEvent): void {
  event.preventDefault()
  dragDepth += 1
  isDragging.value = true
}

/** dragover: ドロップを許可するため必ず preventDefault（要件 1.2 の前提）。 */
function onDragOver(event: DragEvent): void {
  event.preventDefault()
  isDragging.value = true
}

/** dragleave: 深さを減らし、領域から完全に離れた（0 以下）ときだけ FB を畳む。 */
function onDragLeave(event: DragEvent): void {
  event.preventDefault()
  dragDepth -= 1
  if (dragDepth <= 0) {
    dragDepth = 0
    isDragging.value = false
  }
}

/**
 * drop: ブラウザの既定遷移を抑止し FB を畳む。ファイル受け入れ経由で検証し、
 * PDF なら ArrayBuffer を `file` emit、非PDF なら store.setError(invalid-type)。
 */
async function onDrop(event: DragEvent): Promise<void> {
  event.preventDefault()
  dragDepth = 0
  isDragging.value = false

  const result = await intake.fromDrop(event)
  if (result.ok) {
    emit('file', result.buffer)
  } else {
    store.setError({
      kind: 'invalid-type',
      message: 'PDF 形式のファイルではありません',
    })
  }
}
</script>

<template>
  <div
    ref="root"
    class="pdf-dropzone"
    data-test="dropzone"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <slot />

    <v-overlay
      :model-value="isDragging"
      contained
      persistent
      location-strategy="static"
      scroll-strategy="none"
      :attach="root ?? undefined"
      class="pdf-dropzone__overlay align-center justify-center"
      content-class="pdf-dropzone__content"
    >
      <div data-test="drag-feedback" class="pdf-dropzone__feedback">
        <v-icon
          icon="mdi-file-pdf-box"
          size="64"
          class="pdf-dropzone__icon"
        />
        <p class="pdf-dropzone__message">PDF をここにドロップ</p>
      </div>
    </v-overlay>
  </div>
</template>

<style scoped>
.pdf-dropzone {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 100%;
}
.pdf-dropzone__feedback {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 2rem;
  text-align: center;
  color: #fff;
  pointer-events: none;
}
.pdf-dropzone__message {
  font-size: 1.25rem;
  font-weight: 600;
}
</style>
