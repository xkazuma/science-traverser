/**
 * Document-load composable (design.md "Components → usePdfDocument", Req 1.x/2.x/7.x).
 *
 * Drives the actual pdfjs document load and mirrors its lifecycle into the
 * single-truth `pdfStore`: `loading → ready | error`, progress, teardown.
 *
 * Boundary commitment (design.md "Boundary Commitments"): this module reaches
 * pdfjs ONLY through `@/lib/pdf/pdfjs` — it never imports `pdfjs-dist` directly.
 *
 * Responsibilities:
 * - `open(source)` — Req 7.1 (loading 表示), 7.2 (進捗): start the store's
 *   `loading` state, create the loading task, wire `onProgress → loadProgress`,
 *   await the document, and set `ready` (doc + numPages) on success.
 * - エラー写像 — Req 7.3/7.4: map the thrown error to a `PdfError` kind
 *   (`password` / `corrupt` / `unknown`) and set the store's `error` state.
 * - `close()` — 破棄: destroy the loading task (which tears the document down in
 *   pdfjs v6, where `PDFDocumentProxy` has no `destroy()`) and reset the store.
 */
import { getDocument, InvalidPDFException } from '@/lib/pdf/pdfjs'
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
} from '@/lib/pdf/pdfjs'
import { usePdfStore } from '@/stores/pdfStore'
import type { PdfError } from '@/types/pdf'

export interface UsePdfDocument {
  /** 読み込み: loading→ready/error、onProgress を loadProgress へ写像。 */
  open(source: ArrayBuffer): Promise<void>
  /** 破棄: loadingTask.destroy() + store.reset()。多重呼び出し安全。 */
  close(): void
}

/** pdfjs の onProgress コールバック引数（`OnProgressParameters` の必要部分）。 */
interface ProgressParams {
  loaded: number
  total: number
}

/**
 * 読み込みエラーを `PdfError` に写像する純粋ヘルパ（Req 7.3, 7.4）。
 *
 * pdfjs-dist v6.0.227 は `PasswordException` を公開エントリから export しない
 * （`InvalidPDFException` のみ）。そのため password は `err.name` で判定する
 * （pdfjs の例外は `.name` を持つ）。corrupt は `InvalidPDFException` の instance
 * もしくは `.name === 'InvalidPDFException'` で判定する。その他は `unknown`。
 *
 * 純粋関数として export することで、暗号化 PDF を用意せずに password 写像
 * （7.4）まで含めユニットテスト可能にする。
 */
export function mapLoadError(err: unknown): PdfError {
  const name =
    typeof err === 'object' && err !== null && 'name' in err
      ? (err as { name?: unknown }).name
      : undefined
  const rawMessage =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : ''

  if (name === 'PasswordException') {
    return {
      kind: 'password',
      message: 'このPDFはパスワードで保護されています。',
    }
  }

  if (err instanceof InvalidPDFException || name === 'InvalidPDFException') {
    return {
      kind: 'corrupt',
      message: 'PDFが破損しているため読み込めませんでした。',
    }
  }

  return {
    kind: 'unknown',
    message: rawMessage || 'PDFの読み込み中に不明なエラーが発生しました。',
  }
}

export function usePdfDocument(): UsePdfDocument {
  const store = usePdfStore()

  // 現在の読み込みタスク（破棄に必要）。pdfjs v6 では doc 自体に destroy() が
  // 無く、loadingTask.destroy() がドキュメントごと破棄するためこちらを保持する。
  let loadingTask: PDFDocumentLoadingTask | null = null

  async function open(source: ArrayBuffer): Promise<void> {
    // 進行中タスクがあれば先に破棄（再 open 時の取りこぼし防止）。
    teardownTask()

    // 状態を loading に（Req 7.1 開始）。store が source を保持する。
    store.load(source)

    // pdfjs はワーカー転送時に渡された ArrayBuffer を detach（転送）し得る。
    // store が保持する `source` が detach されないよう、コピーを渡す。
    const data = source.slice(0)

    const task = getDocument({ data })
    loadingTask = task

    // 進捗結線（Req 7.2）。total 不明時は null（=不定）にフォールバック。
    task.onProgress = ({ loaded, total }: ProgressParams): void => {
      store.setProgress(total ? loaded / total : null)
    }

    let doc: PDFDocumentProxy
    try {
      doc = await task.promise
    } catch (err) {
      // open() 中に close() でタスクが差し替え/破棄された場合は無視する。
      if (loadingTask !== task) return
      store.setError(mapLoadError(err)) // Req 7.3 / 7.4 / unknown
      return
    }

    // await 中に close()/別 open() が走っていたら、この結果は破棄する。
    if (loadingTask !== task) {
      await task.destroy().catch(() => undefined)
      return
    }

    // 成功（Req 7.1 終端）。store が markRaw 保持する。
    store.setReady(doc, doc.numPages)
  }

  /** 進行中の loadingTask を破棄しクリアする（多重破棄ガード込み）。 */
  function teardownTask(): void {
    if (loadingTask === null) return
    const task = loadingTask
    loadingTask = null
    // destroy() は Promise を返すが close() は同期契約のため待たない。
    void task.destroy().catch(() => undefined)
  }

  function close(): void {
    teardownTask()
    store.reset()
  }

  return { open, close }
}
