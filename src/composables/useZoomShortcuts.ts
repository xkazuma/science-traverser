/**
 * ブラウザのズーム操作を PDF ズームへ転用する composable（要件 4.6）。
 *
 * Ctrl/Cmd と「+ / = / - / 0」キー、および Ctrl/Cmd + ホイールを横取りし、
 * ブラウザ自身のページズームではなく `pdfStore` のズーム（zoomIn/zoomOut/等倍）へ
 * マッピングする。`status === 'ready'` のときのみ介入し、未読込（idle 等）では
 * 何もせず既定のブラウザ動作に委ねる。
 *
 * 結線: `PdfViewer.vue` の setup で `useZoomShortcuts()` を一度だけ呼ぶ。onMounted で
 * `window` にリスナを登録し、onBeforeUnmount で解除する（ライフサイクル自己管理）。
 *
 * 注意（プラットフォーム依存）:
 * - Ctrl/Cmd + ホイールは `{ passive: false }` 登録により `preventDefault()` で
 *   確実に抑止できる（ブラウザのズームを止めて PDF ズームへ振り替えられる）。
 * - キーボードズーム（Ctrl/Cmd + +/-/0）の横取りはブラウザ依存であり、仕様上
 *   保証されない（ブラウザによっては preventDefault してもネイティブズームが走る
 *   ことがある）。ベストエフォートとして実装する。
 *
 * 境界規約: pdfjs を直接 import しない。状態は `usePdfStore` 経由でのみ参照する。
 */
import { onBeforeUnmount, onMounted } from 'vue'

import { usePdfStore } from '@/stores/pdfStore'

/** ズーム拡大に対応するキー集合（'+' と '=' は同一キー上の刻印差）。 */
const ZOOM_IN_KEYS = new Set(['+', '='])
/** ズーム縮小キー。 */
const ZOOM_OUT_KEYS = new Set(['-'])
/** 等倍リセットキー。 */
const ZOOM_RESET_KEYS = new Set(['0'])

/**
 * ブラウザズーム横取りを有効化する。戻り値は無し（ライフサイクルで自己管理）。
 */
export function useZoomShortcuts(): void {
  const store = usePdfStore()

  function onKeydown(e: KeyboardEvent): void {
    if (!(e.ctrlKey || e.metaKey)) return
    const isZoomKey =
      ZOOM_IN_KEYS.has(e.key) ||
      ZOOM_OUT_KEYS.has(e.key) ||
      ZOOM_RESET_KEYS.has(e.key)
    if (!isZoomKey) return
    // 未読込ならブラウザの既定ズームに委ねる（介入しない）。
    if (store.status !== 'ready') return
    e.preventDefault()
    if (ZOOM_IN_KEYS.has(e.key)) {
      store.zoomIn()
    } else if (ZOOM_OUT_KEYS.has(e.key)) {
      store.zoomOut()
    } else {
      // 等倍へリセット（手動倍率モードへ戻す）。
      store.setScale(1)
      store.setFitMode('none')
    }
  }

  function onWheel(e: WheelEvent): void {
    if (!(e.ctrlKey || e.metaKey)) return
    // 未読込なら preventDefault せずブラウザのズームを許可する。
    if (store.status !== 'ready') return
    e.preventDefault()
    if (e.deltaY < 0) {
      store.zoomIn()
    } else if (e.deltaY > 0) {
      store.zoomOut()
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeydown)
    // passive:false でないと Ctrl+ホイールの preventDefault が無視される。
    window.addEventListener('wheel', onWheel, { passive: false })
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown)
    window.removeEventListener('wheel', onWheel)
  })
}
