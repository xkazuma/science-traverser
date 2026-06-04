import { afterEach, describe, expect, it, vi } from 'vitest'

import { usePdfPageRender } from '@/composables/usePdfPageRender'
import type { PageViewport, PDFPageProxy, RenderTask } from '@/lib/pdf/pdfjs'

/**
 * Unit tests for the page-render composable (Req 2.2 DPR鮮明描画, 4.1
 * ズーム時に前回をキャンセル).
 *
 * jsdom has no real 2D canvas context and no real Worker, so a true pixel
 * render cannot run here (deferred to the E2E smoke, task 6.1). We unit-test
 * the *orchestration* — DPR sizing, previous-task cancellation, and
 * RenderingCancelledException swallowing — with a controllable fake page whose
 * `render()` hands back a fake RenderTask whose promise we resolve/reject on
 * demand.
 */

/** A fake RenderTask whose completion we drive from the test. */
interface ControllableTask {
  task: RenderTask
  cancel: ReturnType<typeof vi.fn>
  resolve: () => void
  reject: (err: unknown) => void
}

function makeControllableTask(): ControllableTask {
  let resolve!: () => void
  let reject!: (err: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  const cancel = vi.fn<() => void>()
  // Only the members the composable touches are real; cast through unknown to
  // satisfy the structural RenderTask type without pulling in private fields.
  const task = { promise, cancel } as unknown as RenderTask
  return { task, cancel, resolve, reject }
}

/** Captured arguments of the most recent `page.render(...)` call. */
interface RenderArgs {
  canvas: unknown
  canvasContext: unknown
  viewport: PageViewport
  transform: number[] | undefined
}

interface FakePage {
  page: PDFPageProxy
  /** Tasks handed back by render(), in call order. */
  tasks: ControllableTask[]
  /** Arguments captured per render() call, in call order. */
  calls: RenderArgs[]
  getViewport: ReturnType<typeof vi.fn>
}

/**
 * Build a fake PDFPageProxy. `getViewport({ scale })` returns a 100*scale ×
 * 200*scale viewport; `render(params)` records its args and returns a fresh
 * controllable task each call.
 */
function makeFakePage(): FakePage {
  const tasks: ControllableTask[] = []
  const calls: RenderArgs[] = []

  const getViewport = vi.fn(({ scale }: { scale: number }): PageViewport => {
    return {
      width: 100 * scale,
      height: 200 * scale,
      scale,
    } as unknown as PageViewport
  })

  const render = vi.fn((params: RenderArgs): RenderTask => {
    calls.push({
      canvas: params.canvas,
      canvasContext: params.canvasContext,
      viewport: params.viewport,
      transform: params.transform,
    })
    const controllable = makeControllableTask()
    tasks.push(controllable)
    return controllable.task
  })

  const page = { getViewport, render } as unknown as PDFPageProxy
  return { page, tasks, calls, getViewport }
}

/**
 * Create a canvas whose getContext('2d') returns a non-null dummy context
 * (jsdom returns null), so the render path runs. We never draw real pixels.
 */
function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  const ctx = {} as CanvasRenderingContext2D
  vi.spyOn(canvas, 'getContext').mockReturnValue(
    ctx as unknown as RenderingContext,
  )
  return canvas
}

const originalDpr = globalThis.devicePixelRatio

function setDpr(value: number): void {
  Object.defineProperty(window, 'devicePixelRatio', {
    value,
    configurable: true,
    writable: true,
  })
}

afterEach(() => {
  setDpr(originalDpr ?? 1)
  vi.restoreAllMocks()
})

describe('usePdfPageRender', () => {
  describe('DPR backing store sizing (Req 2.2)', () => {
    it('sizes the backing store by devicePixelRatio and the CSS box by viewport dims (dpr=2)', async () => {
      setDpr(2)
      const { render } = usePdfPageRender()
      const fake = makeFakePage()
      const canvas = makeCanvas()

      const pending = render(canvas, fake.page, 1)
      // Backing store is viewport dims × dpr; CSS box is viewport dims.
      expect(canvas.width).toBe(200) // 100 * 1 * 2
      expect(canvas.height).toBe(400) // 200 * 1 * 2
      expect(canvas.style.width).toBe('100px')
      expect(canvas.style.height).toBe('200px')

      fake.tasks[0].resolve()
      await pending
    })

    it('sizes the backing store 1:1 when dpr=1', async () => {
      setDpr(1)
      const { render } = usePdfPageRender()
      const fake = makeFakePage()
      const canvas = makeCanvas()

      const pending = render(canvas, fake.page, 1)
      expect(canvas.width).toBe(100)
      expect(canvas.height).toBe(200)
      expect(canvas.style.width).toBe('100px')
      expect(canvas.style.height).toBe('200px')

      fake.tasks[0].resolve()
      await pending
    })

    it('floors fractional dimensions for both backing store and CSS box', async () => {
      setDpr(1.5)
      const { render } = usePdfPageRender()
      const fake = makeFakePage()
      const canvas = makeCanvas()

      // viewport = 100*1.25 × 200*1.25 = 125 × 250; backing = ×1.5 = 187.5/375.
      const pending = render(canvas, fake.page, 1.25)
      expect(canvas.width).toBe(187) // floor(125 * 1.5)
      expect(canvas.height).toBe(375) // floor(250 * 1.5)
      expect(canvas.style.width).toBe('125px')
      expect(canvas.style.height).toBe('250px')

      fake.tasks[0].resolve()
      await pending
    })
  })

  describe('transform passed to page.render reflects DPR (Req 2.2)', () => {
    it('passes a [dpr,0,0,dpr,0,0] transform when dpr !== 1', async () => {
      setDpr(2)
      const { render } = usePdfPageRender()
      const fake = makeFakePage()
      const canvas = makeCanvas()

      const pending = render(canvas, fake.page, 1)
      expect(fake.calls).toHaveLength(1)
      expect(fake.calls[0].transform).toEqual([2, 0, 0, 2, 0, 0])
      expect(fake.calls[0].canvasContext).toBe(canvas.getContext('2d'))
      // v6 contract: with an explicit context, `canvas` is passed as null.
      expect(fake.calls[0].canvas).toBeNull()
      expect(fake.calls[0].viewport).toBe(fake.getViewport.mock.results[0].value)

      fake.tasks[0].resolve()
      await pending
    })

    it('omits the transform (undefined) when dpr === 1', async () => {
      setDpr(1)
      const { render } = usePdfPageRender()
      const fake = makeFakePage()
      const canvas = makeCanvas()

      const pending = render(canvas, fake.page, 1)
      expect(fake.calls[0].transform).toBeUndefined()

      fake.tasks[0].resolve()
      await pending
    })
  })

  describe('cancellation of the previous task (Req 4.1)', () => {
    it('cancels the in-flight task exactly once when render() is called again before it resolves', async () => {
      setDpr(1)
      const { render } = usePdfPageRender()
      const fake = makeFakePage()
      const canvas = makeCanvas()

      // Task A in flight (never resolved yet).
      const pendingA = render(canvas, fake.page, 1)
      expect(fake.tasks).toHaveLength(1)
      expect(fake.tasks[0].cancel).not.toHaveBeenCalled()

      // Re-render before A completes → A must be cancelled before B starts.
      const pendingB = render(canvas, fake.page, 2)
      expect(fake.tasks[0].cancel).toHaveBeenCalledTimes(1)
      expect(fake.tasks).toHaveLength(2)
      expect(fake.tasks[1].cancel).not.toHaveBeenCalled()

      // A rejects as cancelled (pdfjs behavior); its render() promise must
      // still resolve (swallowed), not throw.
      fake.tasks[0].reject({ name: 'RenderingCancelledException' })
      await expect(pendingA).resolves.toBeUndefined()

      fake.tasks[1].resolve()
      await expect(pendingB).resolves.toBeUndefined()
    })

    it('cancel() cancels the in-flight task', async () => {
      setDpr(1)
      const { render, cancel } = usePdfPageRender()
      const fake = makeFakePage()
      const canvas = makeCanvas()

      const pending = render(canvas, fake.page, 1)
      cancel()
      expect(fake.tasks[0].cancel).toHaveBeenCalledTimes(1)

      fake.tasks[0].reject({ name: 'RenderingCancelledException' })
      await expect(pending).resolves.toBeUndefined()
    })

    it('cancel() is a no-op when nothing is in flight', () => {
      const { cancel } = usePdfPageRender()
      expect(() => cancel()).not.toThrow()
    })
  })

  describe('RenderingCancelledException swallowing vs real errors (Req 4.1)', () => {
    it('swallows a rejection named RenderingCancelledException (resolves)', async () => {
      setDpr(1)
      const { render } = usePdfPageRender()
      const fake = makeFakePage()
      const canvas = makeCanvas()

      const pending = render(canvas, fake.page, 1)
      fake.tasks[0].reject({ name: 'RenderingCancelledException' })
      await expect(pending).resolves.toBeUndefined()
    })

    it('re-throws a generic rendering error', async () => {
      setDpr(1)
      const { render } = usePdfPageRender()
      const fake = makeFakePage()
      const canvas = makeCanvas()

      const pending = render(canvas, fake.page, 1)
      fake.tasks[0].reject(new Error('boom'))
      await expect(pending).rejects.toThrow('boom')
    })

    it('clears the stored task after success so a later cancel() is a no-op', async () => {
      setDpr(1)
      const { render, cancel } = usePdfPageRender()
      const fake = makeFakePage()
      const canvas = makeCanvas()

      const pending = render(canvas, fake.page, 1)
      fake.tasks[0].resolve()
      await pending

      // Task completed and was cleared → cancel() must not re-cancel it.
      cancel()
      expect(fake.tasks[0].cancel).not.toHaveBeenCalled()
    })
  })

  describe('missing 2D context', () => {
    it('throws a clear error when getContext("2d") returns null', async () => {
      setDpr(1)
      const { render } = usePdfPageRender()
      const fake = makeFakePage()
      const canvas = document.createElement('canvas')
      vi.spyOn(canvas, 'getContext').mockReturnValue(null)

      await expect(render(canvas, fake.page, 1)).rejects.toThrow(/2d|context/i)
      // No render was attempted without a context.
      expect(fake.calls).toHaveLength(0)
    })
  })
})
