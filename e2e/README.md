# E2E スモークテスト（手動・実ブラウザ）

タスク 6.1 の「実機ブラウザ」検証用の Playwright スモーク。jsdom では検証できない
**実際のキャンバス描画と本物の Web Worker** を実ブラウザで確認する。ユニット/コンポーネント
テスト（`pnpm test`）が全要件を振る舞いレベルで網羅するのに対し、本スモークは
「PDF が実際に目に見えて描画・操作できる」最後の一点を埋める。

## 検証内容（要件対応）
- 初期状態でファイルを開く案内が出る（7.5）
- ファイル選択で PDF を開くとページの canvas が**実際に描画される**（非空ピクセル）（2.1/2.2）
- テキスト層に選択可能な span が生成される（2.3）
- ページ総数表示（3.1）、次ページで現在ページが追従（3.2/3.3）
- ズームで倍率が変化（4.1）、幅フィットが動作（4.3）
- 非PDF を開くとエラー表示（1.4/7）
- ページ実行時の未捕捉エラーが無い

## 実行手順
```bash
# 1) 本番ビルドを作成
pnpm build

# 2) ビルド成果物を配信（別ターミナル）
npx vite preview --port 4173 --strictPort

# 3) ブラウザと OS 依存ライブラリを導入（初回のみ。root/apt が必要）
npx playwright install --with-deps chromium
# WSL/Debian 系で sudo が要る場合: sudo npx playwright install-deps chromium

# 4) スモーク実行（playwright npm パッケージが必要）
npm i -D playwright   # 未導入なら
node e2e/smoke.mjs
```
`SMOKE_URL` 環境変数で配信先 URL を上書き可能（既定 `http://localhost:4173/`）。
全チェック通過で終了コード 0。スクリーンショットは OS の一時ディレクトリに出力。

## 注意
- 本ハーネスは CI 必須化していない（ブラウザ + OS ライブラリの導入が前提のため）。
- `playwright` は `package.json` の依存に含めていない。実行時にオンデマンドで導入する。
- フィクスチャ `fixture-3page.pdf` は 3 ページ（"Page 1/2/3" テキスト入り）の最小 PDF。
