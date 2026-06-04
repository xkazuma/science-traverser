# Research & Design Decisions — pdf-viewer

## Summary
- **Feature**: `pdf-viewer`
- **Discovery Scope**: New Feature（グリーンフィールド）
- **Key Findings**:
  - `pdfjs-dist` v6 系では Vite がワーカーを自動解決しない。ESM ワーカーを `?url` で import し
    `GlobalWorkerOptions.workerSrc` に設定するのが dev/build 両対応の正攻法。CDN 固定は禁止。
  - ラッパーライブラリ（vue-pdf-embed 等）はページ内 DOM を専有するため、将来のピクセル精度
    オーバーレイ要件に対して制約が大きい。raw `pdfjs-dist` で描画ループを自前所有するのが適切。
  - PDF の座標（左下原点・無倍率）を `PageViewport.convertToViewportPoint / convertToPdfPoint` で
    相互変換でき、永続データを PDF 単位で持てば任意ズームで再射影できる（将来機能の基盤）。

## Research Log

### pdfjs-dist のワーカー設定（Vite）
- **Context**: Vite で pdfjs を使う際の最頻出のビルド／実行時エラー（ワーカー未解決・バージョン不一致）。
- **Sources Consulted**: pdfjs-dist npm, mozilla/pdf.js issue #19519 / discussion #19520, pdf.js releases。
- **Findings**:
  - v4+ 以降ワーカーは自前設定が必須。`import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`
    で Vite がアセットとしてフィンガープリント（dev/build 両対応）。
  - pdfjs を複数経路（`pdfjs-dist` と `/build/pdf.mjs` と `/legacy/`）から import するとインスタンス
    重複・ワーカーバージョン不一致を招く。import は単一モジュールに限定する。
  - ESM ワーカー非対応ブラウザ向けには `legacy/build/pdf.worker.min.mjs?url` をフォールバック。
- **Implications**: `src/lib/pdf/pdfjs.ts` を「pdfjs を import する唯一のモジュール」とする境界を採用。

### v6 API の差異
- **Context**: 旧来 API（`renderTextLayer()` 等）の情報が多く混在する。
- **Findings**: 描画は `page.render({ canvas または canvasContext, viewport })`。テキスト層は
  `TextLayer` クラス（`new TextLayer({...}).render()`）。`RenderTask.cancel()` は
  `RenderingCancelledException` を投げるため捕捉が必要。
- **Implications**: 描画・テキスト層・キャンセルを composables に隔離し、API 変更の影響を一点に閉じる。

### 描画ライブラリ選定（raw vs ラッパー）
- **Context**: フェーズ1の速度よりも将来のオーバーレイ要件（注釈・領域・グラフ）を優先。
- **Findings**: ラッパーはページ内レイヤを専有し、座標ヒットテスト・描画スケジューリング
  （ズーム時キャンセル・DPR・仮想化）の制御を阻害する。raw 利用なら約150行の描画コードで完全制御。
- **Implications**: raw `pdfjs-dist` を採用（Build vs Adopt の結論）。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Layered（採用） | UI → composables → store → lib/pdf の一方向依存 | 境界明確・テスト容易・pdfjs 隔離 | 規約遵守の徹底が必要 | steering の規約と一致 |
| ラッパーライブラリ依存 | vue-pdf-embed 等に描画委譲 | 立ち上げ最速 | オーバーレイ制御が困難・将来要件で破綻 | 却下 |

## Design Decisions

### Decision: raw pdfjs-dist + 自前オーバーレイ層
- **Context**: 要件 8（オーバーレイ拡張基盤）と将来構想。
- **Alternatives Considered**: 1) ラッパーライブラリ 2) raw pdfjs。
- **Selected Approach**: ページを「キャンバス層 + テキスト層 + オーバーレイ層」のスタックとして
  自前描画し、オーバーレイ層をスコープ付きスロットで公開。
- **Rationale**: 座標系を所有でき、将来機能をデータ移行なしに追加できる。
- **Trade-offs**: 描画・キャンセル・DPR・仮想化のコードを自前で持つ必要がある。
- **Follow-up**: ワーカー設定・DPR 鮮明性・ズーム時キャンセルを実装時に検証。

### Decision: 座標を PDF 単位で保持
- **Context**: 要件 2.4 / 8.2 / 8.3。
- **Selected Approach**: 永続・受け渡しは PDF 単位、表示時に viewport で再射影。
- **Rationale**: 単一座標系で注釈・領域・グラフを将来統合でき、ズーム不変。

### Decision: 連続スクロール + 仮想化
- **Context**: 要件 2.1 / 6。
- **Selected Approach**: 縦連続スクロール。全ページのプレースホルダ高さを事前確保し、
  IntersectionObserver で近傍ページのみ描画、遠方は `page.cleanup()`。
- **Rationale**: 主要な閲覧モデルであり、現在ページ追従と遅延描画が自然に得られる。

### Decision: PDF.js オブジェクトを markRaw 保持
- **Context**: Pinia の deep reactivity による性能劣化回避。
- **Selected Approach**: `PDFDocumentProxy` 等は `markRaw` で保持。

### Decision: 外枠 UI に Vuetify 4 を採用（描画3層は素のまま）
- **Context**: ツールバー・サイドバー・進捗・エラー・ダイアログ・テーマといった標準操作 UI を
  効率的かつ a11y/アイコン込みで構築したい。将来の注釈・解析・グラフ管理で操作 UI が増える見込み。
- **Alternatives Considered**: 1) 素の scoped CSS で自前 2) Vuetify 4 3) PrimeVue/Naive UI。
- **Selected Approach**: chrome（外枠）に Vuetify 4 を採用。`vite-plugin-vuetify`（autoImport/treeshaking）
  + `@mdi/font`。`src/plugins/vuetify.ts` で `createVuetify()`、`main.ts` で `app.use`、`App.vue` を
  `<v-app>` でラップ。**描画3層（Canvas/Text/Overlay）には Vuetify を持ち込まない**。
- **Rationale**: 操作 UI の生産性・統一感・a11y を獲得しつつ、描画の座標精度（DPR・重ね合わせ）は
  素の DOM/canvas で完全制御を維持。Vuetify 4 は Vue 3 と両立。
- **Trade-offs**: 依存・バンドル増（treeshaking で緩和）、Material 寄りの見た目。
- **Follow-up**: コンポーネントテストは Vuetify プラグインを `global.plugins` に登録して mount する。

> 注: Vuetify はユーザー観測可能な新規要件を増やすものではなく実装/技術選定。requirements.md は不変。

### Decision: フィット基準とジャンプ結線（validate-design 反映）
- **Context**: 設計レビューで、ページサイズ不均一×フィット×仮想化の相互作用に未規定箇所を検出。
- **Selected Approach**:
  1. プレースホルダ高さは各ページ固有 viewport × `scale` で個別算出。フィットは**コンテナ幅基準**に統一
     （`width`=最広ページが幅に収まる単一 scale、`page`=最広/最高ページが領域に収まる scale）。
     `scale`/`fitMode`/リサイズで `usePageVirtualizer.recompute(scale)` により全再計算。
  2. ジャンプは `currentPage`（スクロール追従結果）と `pendingScrollTo`（ジャンプ要求）を分離。
     `requestGoToPage(n)` → `PdfViewport` が `offsetOf(n)`（プレースホルダ絶対位置）へスクロール。
     未描画ページにも正しく着地。
- **Rationale**: 単一 `scale` のまま不均一ページでも破綻せず、仮想化下のナビゲーションを保証。

## Risks & Mitigations
- ワーカーのバージョン不一致 → 単一 import 境界 + `?url` 解決、CDN 固定禁止。
- jsdom が canvas/worker を持たない → ユニットは座標・ストアを純粋関数で、コンポーネントは
  pdfjs 境界をモック、ピクセル検証は将来のブラウザ/Playwright スモークへ委譲。
- ズーム連打時のちらつき／競合 → 前回 `RenderTask` を cancel し `RenderingCancelledException` を握り潰す。
- 大規模 PDF のメモリ → 仮想化 + 遠方ページの `cleanup()`。

## References
- [pdfjs-dist npm](https://www.npmjs.com/package/pdfjs-dist) — バージョン確認
- [pdf.js issue #19519](https://github.com/mozilla/pdf.js/issues/19519) / [discussion #19520](https://github.com/mozilla/pdf.js/discussions/19520) — Vite ワーカー import
- [pdf.js releases](https://github.com/mozilla/pdf.js/releases) — v6 API 変更
- [PDF.js API docs](https://mozilla.github.io/pdf.js/api/draft/api.js.html) — viewport / TextLayer
- [Pinia testing](https://pinia.vuejs.org/cookbook/testing.html) — ストアテスト
- [Vuetify 4 installation](https://vuetifyjs.com/en/getting-started/installation/) — vite-plugin-vuetify / createVuetify / MDI
