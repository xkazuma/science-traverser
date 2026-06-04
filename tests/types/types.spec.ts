import { describe, it, expect } from 'vitest'
import type {
  PdfState,
  PdfStatus,
  FitMode,
  PdfErrorKind,
  PdfError,
} from '@/types/pdf'
import type {
  Annotation,
  LayoutRegion,
  LayoutGraphNode,
  LayoutGraphEdge,
  LayoutGraph,
} from '@/types/overlay'
import type { PdfRect } from '@/lib/pdf/coordinates'

// Type-only modules: the strict typecheck (vue-tsc --noEmit) is the primary
// gate. These runtime assertions exist to prove the types are *usable* —
// concrete typed literals compile and the reserved overlay slices have the
// right shapes — and to anchor a couple of compile-time guards.

describe('types/pdf', () => {
  it('a fully-populated PdfState literal type-checks and carries its fields', () => {
    const rect: PdfRect = { x: 10, y: 20, width: 100, height: 40 }
    const annotation: Annotation = {
      id: 'a1',
      page: 1,
      rect,
      kind: 'highlight',
      note: 'see fig. 2',
    }
    const region: LayoutRegion = { id: 'r1', page: 1, rect, label: 'figure' }

    const state: PdfState = {
      source: null,
      doc: null,
      numPages: 0,
      currentPage: 1,
      pendingScrollTo: null,
      scale: 1,
      fitMode: 'width',
      loadProgress: null,
      status: 'idle',
      error: null,
      annotations: { 1: [annotation] },
      layoutRegions: { 1: [region] },
      layoutGraph: null,
    }

    expect(state.status).toBe('idle')
    expect(state.fitMode).toBe('width')
    expect(state.currentPage).toBe(1)
    expect(state.annotations[1]?.[0]?.id).toBe('a1')
    expect(state.layoutRegions[1]?.[0]?.label).toBe('figure')
    expect(state.layoutGraph).toBeNull()
  })

  it('exercises every PdfStatus / FitMode / PdfErrorKind member', () => {
    const statuses: PdfStatus[] = ['idle', 'loading', 'ready', 'error']
    const fitModes: FitMode[] = ['none', 'width', 'page']
    const kinds: PdfErrorKind[] = [
      'invalid-type',
      'corrupt',
      'password',
      'unknown',
    ]
    expect(statuses).toHaveLength(4)
    expect(fitModes).toHaveLength(3)
    expect(kinds).toHaveLength(4)
  })

  it('builds a PdfError with a valid kind', () => {
    const err: PdfError = { kind: 'password', message: 'PDF is encrypted' }
    expect(err.kind).toBe('password')
    expect(err.message).toBe('PDF is encrypted')

    // @ts-expect-error — 'bogus' is not a member of PdfErrorKind
    const bad: PdfError = { kind: 'bogus', message: 'x' }
    void bad
  })

  it('rejects an invalid PdfStatus at compile time', () => {
    // @ts-expect-error — 'paused' is not a member of PdfStatus
    const bad: PdfStatus = 'paused'
    void bad
    expect(true).toBe(true)
  })
})

describe('types/overlay (reserved future stubs)', () => {
  it('reserved overlay types compose into a LayoutGraph', () => {
    const rect: PdfRect = { x: 0, y: 0, width: 50, height: 50 }
    const region: LayoutRegion = { id: 'r1', page: 2, rect, label: 'table' }
    const node: LayoutGraphNode = { id: 'n1', region }
    const edge: LayoutGraphEdge = { from: 'n1', to: 'n2', relation: 'caption-of' }
    const graph: LayoutGraph = { nodes: [node], edges: [edge] }

    expect(graph.nodes[0]?.region.label).toBe('table')
    expect(graph.edges[0]?.relation).toBe('caption-of')
    expect(graph.nodes[0]?.region.rect.width).toBe(50)
  })

  it('Annotation note is optional', () => {
    const rect: PdfRect = { x: 1, y: 2, width: 3, height: 4 }
    const ann: Annotation = { id: 'a', page: 1, rect, kind: 'box' }
    expect(ann.note).toBeUndefined()
  })
})
