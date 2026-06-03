/**
 * File intake composable: converts a user-selected or drag-and-dropped file
 * into an in-memory `ArrayBuffer` after validating it is a PDF.
 *
 * Scope (Requirements 1.1, 1.2, 1.4, 1.5):
 * - 1.1 選択で読み込み開始 — `fromInput` reads from a file-input `FileList`.
 * - 1.2 D&Dで読み込み開始 — `fromDrop` reads from a `DragEvent`'s dataTransfer.
 * - 1.4 非PDFは読み込まずエラー — non-PDF input resolves to `invalid-type`.
 * - 1.5 外部サーバへ送信せずクライアント内のみ — this module performs no
 *   network I/O whatsoever; it only uses the local `File`/`Blob` API
 *   (`file.arrayBuffer()`). There are intentionally no `fetch`/`XHR`/upload
 *   calls here, keeping file contents entirely in the browser.
 *
 * Validation accepts a file whose MIME type is `application/pdf` OR whose name
 * ends with `.pdf` (case-insensitive) as an extension fallback, since some
 * environments report an empty or generic MIME type.
 */

export type FileIntakeResult =
  | { ok: true; buffer: ArrayBuffer }
  | { ok: false; kind: 'invalid-type' }

export interface UseFileIntake {
  fromInput(files: FileList | null): Promise<FileIntakeResult>
  fromDrop(event: DragEvent): Promise<FileIntakeResult>
}

const PDF_MIME = 'application/pdf'
const PDF_EXTENSION = '.pdf'

const INVALID_TYPE: FileIntakeResult = { ok: false, kind: 'invalid-type' }

function isPdf(file: File): boolean {
  if (file.type === PDF_MIME) return true
  return file.name.toLowerCase().endsWith(PDF_EXTENSION)
}

/**
 * Shared validation + read path for both entry points. Reads the first file's
 * bytes locally via the File API; never transmits them anywhere.
 */
async function intake(file: File | null | undefined): Promise<FileIntakeResult> {
  if (!file || !isPdf(file)) return INVALID_TYPE
  const buffer = await file.arrayBuffer()
  return { ok: true, buffer }
}

export function useFileIntake(): UseFileIntake {
  async function fromInput(files: FileList | null): Promise<FileIntakeResult> {
    return intake(files?.item(0) ?? files?.[0] ?? null)
  }

  async function fromDrop(event: DragEvent): Promise<FileIntakeResult> {
    return intake(event.dataTransfer?.files?.[0] ?? null)
  }

  return { fromInput, fromDrop }
}
