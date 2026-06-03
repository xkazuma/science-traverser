# Technology Stack

## Architecture

クライアントサイド SPA。PDF.js の描画ループを **自前で所有** し、ページごとに「キャンバス層 +
テキスト層 + オーバーレイ層」を同一原点で重ねる構成を採る。状態は Pinia に集約し、PDF.js への
アクセスは単一の境界モジュールに閉じ込める。サーバーサイドは持たない（フェーズ1）。

## Core Technologies

- **Language**: TypeScript（strict）
- **Framework**: Vue 3.5（`<script setup>` SFC）
- **Build**: Vite
- **State**: Pinia
- **Runtime / Package Manager**: Node.js + **pnpm**

## Key Libraries

- **`pdfjs-dist`（raw 利用、ラッパー不使用）**: PDF 描画エンジン。ラッパーライブラリは使わず、
  キャンバス描画とオーバーレイ層を自前で制御する（将来のピクセル精度オーバーレイのため）。
- **Vue Router は不採用（フェーズ1）**: 単一画面のため。`App.vue` を薄く保ち、後から追加可能に
  しておく。
- **Vuetify 4（Material Design）**: アプリの**外枠（chrome）専用**の UI フレームワーク。
  ツールバー・サイドバー・進捗・エラー/空状態・ダイアログ・テーマに利用し、a11y・アイコン・
  レスポンシブを標準で得る。`vite-plugin-vuetify`（`{ autoImport: true }`）+ `@mdi/font` を用いる。
- **CSS**: 外枠は Vuetify。**PDF 描画3層（キャンバス層・テキスト層・オーバーレイ層）は
  スコープ付き CSS + CSS カスタムプロパティの素の DOM/canvas**（座標計算を阻害しないため）。

## Development Standards

### Type Safety
- TypeScript strict。`any` を避ける。

### Testing
- **Vitest** + `@vue/test-utils` + jsdom。
- 最重要ユニットテスト: 座標変換（往復恒等・軸反転・DPR）、Pinia ストアの状態遷移、
  ファイル受け入れの MIME 検証。
- コンポーネントテストは `pdfjs.ts` 境界をモックして実施（jsdom は canvas/worker を持たない）。

## Common Commands
```bash
# Dev:   pnpm dev
# Build: pnpm build
# Test:  pnpm test
```

## Key Technical Decisions

### pdfjs ワーカー設定（Vite の最重要落とし穴）
ESM ワーカーを `?url` で import し、Vite にアセットとしてフィンガープリントさせる（dev/build 両対応）。
CDN 固定は禁止（ワーカーのバージョンはインストール済みライブラリと一致させる必要がある）。

```ts
// src/lib/pdf/pdfjs.ts — pdfjs を import する唯一のモジュール
import * as pdfjsLib from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker
export { pdfjsLib }
```

- pdfjs は **単一の import パス** からのみ取得する（複数経路はインスタンス重複・ワーカー
  バージョン不一致の原因）。
- v6 API: 描画は `{ canvas/canvasContext, viewport }`、テキスト層は `TextLayer` クラス
  （旧 `renderTextLayer()` ではない）。ESM ワーカー非対応環境のみ `legacy/` をフォールバック。

### 座標系（拡張性の要）
永続化対象は **PDF 単位（左下原点・無倍率）** で保持し、表示時に
`viewport.convertToViewportPoint` / `convertToPdfPoint` で再射影する。これにより
マーカ・メモ・OCR 領域・グラフのノード幾何が、任意のズームでデータ移行なしに正しく再現される
（全機能で単一の座標系）。

### PDF.js オブジェクトの非リアクティブ保持
PDFDocumentProxy 等は巨大かつ自己参照的なので、Pinia には `markRaw` で保持しディープ
リアクティブ化しない。

### Vuetify は外枠専用（描画3層には持ち込まない）
Vuetify コンポーネントは chrome（ツールバー・サイドバー・進捗・エラー/空状態・ダイアログ・テーマ）
のみで使う。**`PdfCanvasLayer` / `PdfTextLayer` / `PdfOverlayLayer` の内部には一切持ち込まない**——
これらは viewport 座標でピクセル精度に位置決めする素の DOM/canvas であり、Vuetify を挟むと
座標制御・DPR・重ね合わせを阻害する。
- セットアップ: `src/plugins/vuetify.ts` で `createVuetify()` を構成し `vuetify/styles` と MDI CSS を
  import。`main.ts` で `app.use(vuetify)`、`App.vue` は `<v-app>` でラップする。

---
_Document standards and patterns, not every dependency_
