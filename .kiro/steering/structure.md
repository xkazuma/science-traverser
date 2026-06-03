# Project Structure

## Organization Philosophy

レイヤード構成。UI（コンポーネント）→ ロジック（composables）→ 状態（store）→ PDF.js 境界
（lib/pdf）という一方向の依存を守る。**コンポーネントは pdfjs を直接 import しない**——必ず
composables / `lib/pdf` 経由でアクセスする。

## Directory Patterns

### PDF.js 境界 (`src/lib/pdf/`)
**Purpose**: pdfjs への唯一のアクセス点と純粋ユーティリティ。
**Example**: `pdfjs.ts`（worker 設定・唯一の import 元）、`coordinates.ts`（PDF単位 ↔ レイヤpx 変換）。

### Composables (`src/composables/`)
**Purpose**: PDF 操作・描画・仮想化などの再利用ロジック。`use*` 命名。
**Example**: `usePdfDocument`, `usePdfPageRender`（DPR対応・再描画キャンセル）, `usePageVirtualizer`,
`useFileIntake`。

### Stores (`src/stores/`)
**Purpose**: ドキュメント／表示状態の集約（Pinia）。
**Example**: `pdfStore.ts`（`doc` は `markRaw` 保持、`status` 状態機械、将来用の予約スライス）。

### Components (`src/components/`)
**Purpose**: `Pdf*` プレフィックスの SFC。ページは「キャンバス層 + テキスト層 + オーバーレイ層」の
スタック。
**Example**: `PdfViewer`, `PdfToolbar`, `PdfViewport`, `PdfPage`, `PdfOverlayLayer`。

### Plugins (`src/plugins/`)
**Purpose**: アプリ全体に登録する Vue プラグインの構成点。
**Example**: `vuetify.ts`（`createVuetify()` + `vuetify/styles` + MDI、`main.ts` で `app.use`）。

### Types / Styles (`src/types/`, `src/styles/`)
**Purpose**: 共有型（`pdf.ts`、将来用 `overlay.ts` 型スタブ）、トークン・レイヤ用 CSS。

## Naming Conventions

- **Components**: PascalCase + `Pdf` プレフィックス（`PdfPage.vue`）。
- **Composables**: `useXxx`（camelCase）。
- **Files (lib/stores/types)**: camelCase（`pdfStore.ts`, `coordinates.ts`）。

## Import Organization

```typescript
import { usePdfDocument } from '@/composables/usePdfDocument' // 絶対 (@/ = src/)
import { pdfjsLib } from '@/lib/pdf/pdfjs'                    // pdfjs はこの境界経由のみ
import PdfPage from './PdfPage.vue'                           // 近接は相対
```

**Path Aliases**: `@/` → `src/`。

## Code Organization Principles

- **単一 pdfjs 境界**: pdfjs の import は `src/lib/pdf/pdfjs.ts` のみ。
- **オーバーレイ拡張点**: `PdfPage` は常に `PdfOverlayLayer` を持ち、スコープ付きスロットで
  viewport と座標変換関数を公開する（フェーズ1では中身が空）。将来の注釈・領域・グラフは
  このスロットの子として追加する。
- **座標は PDF 単位で永続化**: 表示時に再射影。第二の座標系を作らない。
- **将来スライスは予約のみ**: `annotations` / `layoutRegions` / `layoutGraph`（ページ番号キー）は
  型と空スライスを先行宣言し、描画内部には触れない。
- **Vuetify は外枠専用**: chrome コンポーネントのみ Vuetify を使う。描画3層
  （`PdfCanvasLayer` / `PdfTextLayer` / `PdfOverlayLayer`）の内部には Vuetify を持ち込まない。

---
_Document patterns, not file trees. New files following patterns shouldn't require updates_
