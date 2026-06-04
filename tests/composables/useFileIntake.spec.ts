import { describe, expect, it } from 'vitest'

import { useFileIntake } from '@/composables/useFileIntake'

/**
 * Build a minimal `FileList` from an array of `File`s. jsdom does not expose a
 * public `FileList` constructor, so we hand-roll an array-like object that
 * satisfies the structural shape the composable relies on (length + index
 * access + `item`). This keeps the test environment honest without a real DOM
 * input element.
 */
function makeFileList(files: File[]): FileList {
  const list: { [index: number]: File; length: number; item(i: number): File | null } = {
    length: files.length,
    item: (i: number) => files[i] ?? null,
  }
  files.forEach((file, i) => {
    list[i] = file
  })
  return list as unknown as FileList
}

/**
 * Build a `DragEvent`-like object carrying a `dataTransfer.files` FileList.
 * jsdom's `DragEvent`/`DataTransfer` support is incomplete, so a minimal stub
 * is sufficient and matches what the composable reads.
 */
function makeDropEvent(files: File[]): DragEvent {
  return {
    dataTransfer: {
      files: makeFileList(files),
    },
  } as unknown as DragEvent
}

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]) // "%PDF-1.7"

function pdfFile(name = 'doc.pdf', type = 'application/pdf'): File {
  return new File([PDF_BYTES], name, { type })
}

describe('useFileIntake', () => {
  describe('fromInput', () => {
    it('accepts an application/pdf File and reads its bytes into an ArrayBuffer', async () => {
      const intake = useFileIntake()
      const result = await intake.fromInput(makeFileList([pdfFile()]))

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected ok result')
      expect(result.buffer.byteLength).toBe(PDF_BYTES.byteLength)
      expect(Array.from(new Uint8Array(result.buffer))).toEqual(Array.from(PDF_BYTES))
    })

    it('accepts a .pdf filename even when the MIME type is empty (extension fallback)', async () => {
      const intake = useFileIntake()
      const result = await intake.fromInput(makeFileList([pdfFile('report.PDF', '')]))

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected ok result')
      expect(result.buffer.byteLength).toBe(PDF_BYTES.byteLength)
    })

    it('rejects a non-PDF file as invalid-type (Req 1.4)', async () => {
      const intake = useFileIntake()
      const note = new File([new Uint8Array([1, 2, 3])], 'note.txt', { type: 'text/plain' })
      const result = await intake.fromInput(makeFileList([note]))

      expect(result).toEqual({ ok: false, kind: 'invalid-type' })
    })

    it('rejects a null FileList as invalid-type', async () => {
      const intake = useFileIntake()
      const result = await intake.fromInput(null)

      expect(result).toEqual({ ok: false, kind: 'invalid-type' })
    })

    it('rejects an empty FileList as invalid-type', async () => {
      const intake = useFileIntake()
      const result = await intake.fromInput(makeFileList([]))

      expect(result).toEqual({ ok: false, kind: 'invalid-type' })
    })
  })

  describe('fromDrop', () => {
    it('accepts a dropped PDF File and reads its bytes', async () => {
      const intake = useFileIntake()
      const result = await intake.fromDrop(makeDropEvent([pdfFile()]))

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected ok result')
      expect(Array.from(new Uint8Array(result.buffer))).toEqual(Array.from(PDF_BYTES))
    })

    it('rejects a dropped non-PDF as invalid-type', async () => {
      const intake = useFileIntake()
      const png = new File([new Uint8Array([0x89, 0x50])], 'image.png', { type: 'image/png' })
      const result = await intake.fromDrop(makeDropEvent([png]))

      expect(result).toEqual({ ok: false, kind: 'invalid-type' })
    })

    it('rejects a drop event with no files as invalid-type', async () => {
      const intake = useFileIntake()
      const result = await intake.fromDrop(makeDropEvent([]))

      expect(result).toEqual({ ok: false, kind: 'invalid-type' })
    })
  })
})
