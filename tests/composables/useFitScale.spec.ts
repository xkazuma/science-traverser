import { describe, expect, it } from 'vitest'

import { computeFitScale } from '@/composables/useFitScale'
import type { FitPageDimension } from '@/composables/useFitScale'
import { SCALE_MAX, SCALE_MIN } from '@/stores/pdfStore'

/**
 * フィット倍率算出 `computeFitScale` の純粋テスト（task 5.2 / 要件 4.3, 4.4）。
 *
 * フィット基準はコンテナ幅基準（design.md「フィット基準はコンテナ幅基準に統一」）:
 * - 'width' → containerWidth / 最広ページの有効幅（最も広いページが幅に収まる）
 * - 'page'  → min(containerWidth / 最広有効幅, containerHeight / 最高有効高)
 * - 'none'  → null（手動倍率を維持）
 * 回転 90/270 は有効幅高を入れ替える。結果は [SCALE_MIN, SCALE_MAX] にクランプする。
 */
describe('composables/useFitScale — computeFitScale', () => {
  const page = (
    widthPdf: number,
    heightPdf: number,
    rotation = 0,
  ): FitPageDimension => ({ widthPdf, heightPdf, rotation })

  describe("'width' — 最も広いページがコンテナ幅に収まる単一 scale", () => {
    it('コンテナ幅 600 / 最広ページ幅 300 → scale 2.0', () => {
      const scale = computeFitScale(
        'width',
        { width: 600, height: 800 },
        [page(300, 400), page(200, 1000)],
      )
      expect(scale).toBe(2)
    })

    it('別組み合わせ: コンテナ幅 900 / 最広ページ幅 300 → scale 3.0', () => {
      const scale = computeFitScale(
        'width',
        { width: 900, height: 100 },
        [page(150, 200), page(300, 50)],
      )
      expect(scale).toBe(3)
    })

    it('最も広いページ（複数ページ中の最大幅）を基準にする', () => {
      // 最広幅は 400 → 600/400 = 1.5。幅 300 を基準にした 2.0 にはならない。
      const scale = computeFitScale(
        'width',
        { width: 600, height: 800 },
        [page(300, 400), page(400, 400)],
      )
      expect(scale).toBe(1.5)
    })
  })

  describe("'page' — 最広/最高ページが表示領域に収まる単一 scale", () => {
    it('コンテナ 600x800 / ページ 300x400 → min(2, 2) = 2', () => {
      const scale = computeFitScale(
        'page',
        { width: 600, height: 800 },
        [page(300, 400)],
      )
      expect(scale).toBe(2)
    })

    it('幅と高さの制約が異なる場合は厳しい方（min）を選ぶ — 高さ律速', () => {
      // 幅律速: 600/300 = 2、高さ律速: 800/500 = 1.6 → min = 1.6
      const scale = computeFitScale(
        'page',
        { width: 600, height: 800 },
        [page(300, 500)],
      )
      expect(scale).toBe(1.6)
    })

    it('幅と高さの制約が異なる場合は厳しい方（min）を選ぶ — 幅律速', () => {
      // 幅律速: 600/500 = 1.2、高さ律速: 800/400 = 2 → min = 1.2
      const scale = computeFitScale(
        'page',
        { width: 600, height: 800 },
        [page(500, 400)],
      )
      expect(scale).toBe(1.2)
    })

    it('最広ページと最高ページが別ページでも各最大値で制約する', () => {
      // 最広 = 500（幅 600/500=1.2）、最高 = 800（高さ 800/800=1）→ min = 1
      const scale = computeFitScale(
        'page',
        { width: 600, height: 800 },
        [page(500, 200), page(100, 800)],
      )
      expect(scale).toBe(1)
    })
  })

  describe('回転 — 90/270 は有効幅高を入れ替える', () => {
    it("'width' で 90 回転は heightPdf を有効幅として使う", () => {
      // 回転後の有効幅 = heightPdf = 400 → 800/400 = 2。widthPdf=200 由来の 4 ではない。
      const scale = computeFitScale(
        'width',
        { width: 800, height: 1000 },
        [page(200, 400, 90)],
      )
      expect(scale).toBe(2)
    })

    it("'page' で 270 回転は幅高を入れ替えて制約する", () => {
      // 回転後 有効幅=heightPdf=400, 有効高=widthPdf=200
      // 幅: 800/400 = 2、高さ: 800/200 = 4 → min = 2
      const scale = computeFitScale(
        'page',
        { width: 800, height: 800 },
        [page(200, 400, 270)],
      )
      expect(scale).toBe(2)
    })
  })

  describe("'none' / 空入力 / クランプ", () => {
    it("'none' は null を返す（手動倍率を維持）", () => {
      expect(
        computeFitScale('none', { width: 600, height: 800 }, [page(300, 400)]),
      ).toBeNull()
    })

    it('ページが空なら null を返す', () => {
      expect(computeFitScale('width', { width: 600, height: 800 }, [])).toBeNull()
    })

    it('コンテナ幅が 0 以下なら null を返す', () => {
      expect(
        computeFitScale('width', { width: 0, height: 800 }, [page(300, 400)]),
      ).toBeNull()
    })

    it('算出倍率は SCALE_MAX にクランプされる', () => {
      // 600/10 = 60 → SCALE_MAX にクランプ。
      const scale = computeFitScale(
        'width',
        { width: 600, height: 800 },
        [page(10, 10)],
      )
      expect(scale).toBe(SCALE_MAX)
    })

    it('算出倍率は SCALE_MIN にクランプされる', () => {
      // 10/1000 = 0.01 → SCALE_MIN にクランプ。
      const scale = computeFitScale(
        'width',
        { width: 10, height: 10 },
        [page(1000, 1000)],
      )
      expect(scale).toBe(SCALE_MIN)
    })
  })

  describe('padding オプション', () => {
    it('padding はコンテナの有効サイズから差し引かれる', () => {
      // 有効幅 = 600 - 2*50 = 500 → 500/250 = 2
      const scale = computeFitScale(
        'width',
        { width: 600, height: 800 },
        [page(250, 400)],
        { padding: 50 },
      )
      expect(scale).toBe(2)
    })
  })
})
