# 曲面囲碁

球面・トーラス上で囲碁を遊ぶ、ブラウザ用の静的アプリです。入門用 AI との対局と、同じ端末での二人対局に対応します。

## 起動

Python 3 でローカルサーバーを起動します。

```sh
python3 -m http.server --directory dist 8000
```

ブラウザで <http://localhost:8000> を開きます。`dist/` がそのままソース兼配信ファイルです。ビルド、npm パッケージのインストール、API キーは不要です。JavaScript モジュールを使うため、HTML を `file://` で直接開かず HTTP サーバーを使ってください。

## 操作と盤

- 立体盤はドラッグ（タッチ操作ではスワイプ）で画面基準の軸で回転し、交点をクリック（タップ）して着手します。上下が反転しても横方向の操作は反転しません。
- 球面の「全球図」は、前後の半球を正距方位図法で投影します。全交点を表示し、図からも着手できます。円周上で重複表示される点は同じ交点です。
- トーラスの「展開図」は、上下・左右の端がつながる正方格子です。
- 「つながり」をオンにして点を選ぶと、その点と隣接点を確認できます。
- 「遊び方（？）」で、基本の操作とルールを図解で確認できます。
- 終局後の「棋譜をシェア」で棋譜をリンクとして共有でき、リンクを開くと棋譜を再生できます。
- ヘッダーの「アプリ情報」（小画面では「情報」）から、アプリ概要・ルールの注意点・保存方法・ソースコードを確認できます。開閉しても対局は変わりません。
- 盤の上のタブでは、1 手目の前と終局後に、実際の盤を見ながら盤の種類と大きさを選べます。対局中と棋譜の再生中は、誤操作で対局が変わらないようタブを隠します。
- 「新しい対局」から盤の種類（球面・トーラス）、大きさ、相手、自分の色、コミを選べます。設定変更の適用は新しい対局からです。

球面盤は立方体の各面を格子に分割して球面に投影したグラフです。1 辺を `n` 分割したとき、交点は `6n² + 2` 個。立方体の頂点に相当する 8 点だけ次数 3、残りは次数 4 です。

| 大きさ | 球面 | トーラス |
| --- | ---: | ---: |
| 小 | 56 点 | 49 点（7 × 7） |
| 標準 | 98 点 | 81 点（9 × 9） |
| 大 | 152 点 | 121 点（11 × 11） |

## ルールと制約

- 隣接する空点（呼吸点）がなくなった相手の石を取ります。自殺手と過去と同一の盤面を作る着手は禁止です（位置的スーパーコウ）。
- 黒と白が続けてパスすると終局。石と地を合計する面積方式で計算します。同点なら引き分けです。取った石は得点に直接加算しません。
- コミは 0〜9.5 目を 0.5 目刻みで選択でき、初期値は 6.5 目です。**これらの曲面盤で公平になる値を検証したものではなく、暫定設定です。**
- 死に石の自動判定・手動除去はありません。必要な石を取り切ってから終局してください。日本ルールの死活判定付き計算とは異なります。
- 対局・履歴・設定をブラウザの localStorage に自動保存し、再読み込み時に復元します。端末間の同期はありません。新しい対局は保存中の対局を置き換え、サイトデータの削除で保存内容も消えます。ブラウザが保存を許可しない場合は永続化できません。
- Kyokugo AI v2 は候補手を絞り、自分と相手の着手を合わせて最大 4 手先まで探索します。取り・呼吸点・石の勢力と終局時の実得点を評価し、評価係数は自己対局で調整し、改善を確認した盤に採用しています。学習済みモデルは使わず、探索範囲を超えた読みや正確な死活判断はできません。WASM を利用できない場合は、自己対局で重みを調整した一手評価方式の Kyokugo AI v1 で継続します。
- 全球図は中心からの角距離を保ちますが、形・面積は歪みます。小さい画面や大きな盤では交点が密になります。

## 構成

| ファイル | 役割 |
| --- | --- |
| `dist/index.html` / `dist/style.css` | 画面、設定・説明ダイアログ、モバイル向けレイアウト |
| `dist/app.js` | Canvas 描画、操作、対局進行 |
| `dist/orientation.js` | クォータニオンによる画面基準の回転と旧保存形式の姿勢変換 |
| `dist/surface-renderer.js` | 盤面・碁石の奥行きバッファ描画、盤ごとに寸法を揃えた碁石、可視部分に対応した選択判定・強調表示 |
| `dist/engine.js` | 盤のグラフ生成、合法手・取り・反復禁止・得点、簡易 AI |
| `dist/ai-worker.js` / `dist/ai-wasm.js` / `dist/ai-engine.wasm` | 再利用する Worker 内で Rust / WASM による AI 計算。利用できない場合は JS で継続 |
| `dist/ai-position.js` | Worker に渡す着手履歴と、JS フォールバック用の局面復元 |
| `dist/sphere-projection.js` | 二半球の正距方位投影、境界での辺の切り分け |
| `dist/record.js` | 棋譜リンクの符号化と、ルールに沿った再生による検証 |
| `dist/persistence.js` | ブラウザへの自動保存、合法手の再生による保存内容の検証・復元 |
| `docs/ai/` / `experiments/ai/` | AI の現行仕様と、世代・実験ごとの報告書・保存データ |
| `tools/ai-tuner/` | Kyokugo AI v1 / v2 の開発・評価・係数調整ツール |
| `tests/fixtures/ai/` | AI の一致確認に使う固定局面 |

ルールは立体座標ではなく交点と隣接関係のグラフ上で動きます。立体表示と平面表示は同じ交点 ID・対局状態を共有します。処理は端末内で完結し、バックエンドはありません。

## AI

参考にした実装、配信する OSS、開発・学習ツールは [JSON 目録](docs/third-party/catalog.json) で管理し、[読みやすい目録](THIRD_PARTY.md) と [配信用のライセンス表示](dist/third-party.html) を生成しています。配信物には告知全文と [目録 JSON](dist/third-party-catalog.json) を含めています。

一手評価のアーキテクチャを **Kyokugo AI v1**、最大 4 手探索のアーキテクチャを **Kyokugo AI v2** と呼びます。仕様・現在の配信構成は [AI 文書](docs/ai/README.md)、評価結果と保存データは [実験索引](experiments/ai/README.md)、実行方法は [開発ツール](tools/ai-tuner/README.md) にまとめています。

実験版の **Kyokugo AI v3** は小型 GNN とバッチ MCTS を組み合わせ、`?ai=v3` で試せます。WebGPU 推論・初期学習モデル・uv による学習手順は [v3 開発](tools/ai-gnn/README.md) を参照してください。通常対局への採用はまだ行っていません。

### WASM 実装

AI の着手計算は Rust / WASM を使います。画面操作、保存・棋譜、実際の着手検証は JS が担当します。配布済みの `dist/` には WASM を含むため、起動時のビルドは不要です。WASM や Worker を利用できない場合は JS 版で対局を続けます。

WASM 化の範囲、Worker の再利用、ビルド手順は [アプリ用 WASM AI](docs/ai/wasm.md) を参照してください。Rust の実装を変更した場合は `node tools/ai-tuner/build-wasm.mjs` で配信物を更新します。

## テスト

Node.js 24 で動作確認しています。外部パッケージは不要です。

```sh
node tests.mjs
node wasm-tests.mjs
node search-tests.mjs
node v3-tests.mjs
node komi-tests.mjs
node record-tests.mjs
node persistence-tests.mjs
node --experimental-vm-modules persistence-review.mjs
node projection-review.mjs
node rendering-review.mjs
node orientation-tests.mjs
node --experimental-vm-modules rotation-review.mjs
node ui-tests.mjs
UI_WIDTH=390 UI_HEIGHT=844 node ui-tests.mjs
UI_WIDTH=844 UI_HEIGHT=390 node ui-tests.mjs
```

最後の 2 行は POSIX シェル向けです。`UI_WIDTH` / `UI_HEIGHT` を省略すると 360 × 640 の想定になります。

- `persistence-tests.mjs` / `persistence-review.mjs`：保存・復元、破損データ、履歴・スーパーコウ、再読み込み後の AI 再開。後者は新規 VM コンテキストを使う UI シミュレーションです。
- `record-tests.mjs`：棋譜リンクの往復変換と、壊れた・不正なリンクの拒否。
- `search-tests.mjs`：探索版の native / WASM の選択手一致、JS での再生・得点、取り・スーパーコウ・コミに応じたパス判断。
- `wasm-tests.mjs`：配布 WASM と JS の選択手、履歴・スーパーコウ、Worker の再利用と読み込み失敗時のフォールバック。
- `tests.mjs`：盤の構造、合法手、取り、反復禁止、得点、AI など。AI が調整ツールと同じ手を選ぶことも確認します。
- `rendering-review.mjs`：描画バッファの奥行き・可視性・選択判定の検証。実ブラウザの描画テストではありません。
- `projection-review.mjs`：全交点・辺の網羅、境界での切り分け、投影の逆変換・表示範囲・点の衝突など。
- `ui-tests.mjs`：DOM / Canvas スタブによる操作連携テスト。全球図での着手、表示切替、AI、待った、設定、終局など。

UI テストは実ブラウザやスマートフォンの描画・タッチ操作を検証するものではありません。画面表示の変更時には別途実機確認が必要です。

## 配信

静的ホスティングに `dist/` の内容を配置します。

SNS 共有時のカード画像（`og-image.png`）とアイコンは、アプリの盤描画から `node tools/social-card.mjs` で再生成します。ImageMagick 7（Pango 対応）と Noto Sans JP が必要です。

### Cloudflare Workers

公開先は <https://kyokugo.ryusei.dev> です。`wrangler.jsonc` で `dist/` の静的配信と独自ドメインを設定しています。アプリのビルドやサーバー側の実行コードは不要です。

Cloudflare の対象アカウントにログインし、リポジトリのルートで実行します。

```sh
npx --yes wrangler@4.151.3 login
npx --yes wrangler@4.151.3 deploy --dry-run
npx --yes wrangler@4.151.3 deploy
```

デプロイには Workers の編集と `ryusei.dev` の独自ドメイン設定に必要な権限を使います。独自ドメインの DNS と証明書は Cloudflare が管理します。`workers.dev` とプレビュー URL は無効にしています。`dist/` 以外の文書・実験データは配信しません。AI の Rust 実装を変更した場合は、先に上記の WASM ビルドとテストを実行してください。
