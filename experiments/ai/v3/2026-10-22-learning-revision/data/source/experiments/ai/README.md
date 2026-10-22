# Kyokugo AI の実験

仕様の入口は [docs/ai](../../docs/ai/README.md)、実行方法は [tools/ai-tuner](../../tools/ai-tuner/README.md) です。v1 / v2 はアーキテクチャ名で、係数セットと実行方式は別に記録します。

## 実験索引

| 実験 ID | 対象 | 報告書 |
| --- | --- | --- |
| v1/2026-10-20-tuning | v1 の係数調整 | [記録](v1/2026-10-20-tuning/README.md) |
| v1/2026-10-21-wasm-benchmark | v1 の JS / WASM 比較 | [記録](v1/2026-10-21-wasm-benchmark/README.md) |
| v1/2026-10-21-komi | v1 のコミ評価 | [記録](v1/2026-10-21-komi/README.md) |
| v2/2026-10-21-initial | v2 の導入・深さ比較・コミ再検証 | [記録](v2/2026-10-21-initial/README.md) |
| v2/2026-10-21-tuning | v2 の係数調整・盤別採用 | [記録](v2/2026-10-21-tuning/README.md) |
| v3/2026-10-21-initial | 小型 GNN・WebGPU・バッチ MCTS の初期実装 | [記録](v3/2026-10-21-initial/README.md) |
| v3/2026-10-21-strength | GPU 再学習・旧 v3 と v2 への診断対戦 | [記録](v3/2026-10-21-strength/README.md) |
| v3/2026-10-22-tactics | 無駄な打ち込みの回避・捨て石保持の回帰検証 | [記録](v3/2026-10-22-tactics/README.md) |
| v3/2026-10-22-endgame | 実棋譜の終盤の粘り・敗北確定後のパス | [記録](v3/2026-10-22-endgame/README.md) |
| v3/2026-10-22-inference | 専用 WebGPU・CPU の実バッチ推論と速度比較 | [記録](v3/2026-10-22-inference/README.md) |
| v3/2026-10-22-learning | 自己対局教材・追加学習・不採用候補の評価 | [記録](v3/2026-10-22-learning/README.md) |
| v3/2026-10-22-learning-revision | 通常局面での選抜・探索教師の比較・独立評価を通過した重み | [記録](v3/2026-10-22-learning-revision/README.md) |
| v2/2026-10-22-endgame | 生存・敗北確定判定の共通化と v2 のパス改善 | [記録](v2/2026-10-22-endgame/README.md) |

機械可読の索引は [catalog.json](catalog.json) です。各実験は README（報告）、manifest.json（識別情報・出所・データハッシュ）、data/（結果・計画・ログ）を持ちます。

## 新しい実験を追加する

1. [テンプレート](TEMPLATE.md) を使い、v1 / v2 / v3 の下に日付と目的を含む新しいディレクトリを作ります。同日の追試は目的や通番で区別します。
2. アーキテクチャ、係数セット、実行方式、コードの commit / 差分を特定します。新しい manifest の source.baseCommit に実行コードを固定し、未コミット差分があればパッチも data/ へ残します。複数世代の比較は主対象の世代へ置き、比較相手も manifest に記録します。
3. 調整・選定・独立評価の seed、対戦相手、先後交換、局数、コミ、打ち切り、採用基準を実行前に決めます。独立評価を後の選定に使った場合、その役割の変更も記録します。
4. 実行中の出力は tools/ai-tuner/target/ 以下へ置きます。終了後に計画・ログ・結果・失敗候補・集計を新しい data/ へ保存します。
5. README に結論、条件、区間推定、所要時間、限界、再現コマンドを記載し、manifest と catalog へ登録します。ハッシュ一覧は `node tools/ai-tuner/check-experiments.mjs --artifacts experiments/ai/v2/<日付-目的>` で取得できます。
6. `node tools/ai-tuner/check-experiments.mjs` で索引・リンク・ファイル一覧・ハッシュを確認します。配信へ採用する場合は、別途ソース・WASM・テストを更新します。

## 保存と再集計

完了した実験の data/ は過去の測定記録です。追試は新しい実験 ID へ保存し、過去の結果を新しい実行結果で上書きしません。README の説明・リンクは修正できます。生データ自体を訂正する必要があれば、新しい記録として理由と元の記録への参照を残します。

集計ツールは既定で target/reports/ に再集計結果を出します。アーカイブを入力にしても、その場のコード・配信物で再集計した結果が過去の summary.json に置き換わることはありません。

当時の JSON 内のコードパス・CLI 別名・SHA-256 は、その実行時点の情報を保っています。現在のファイルとハッシュが異なることは、記録の破損を意味しません。manifest の recordedAtCommit と legacyPath で整理前の場所を追跡し、保存データ自体は manifest のハッシュで検証します。

## 命名

- アーキテクチャ：Kyokugo AI v1 / Kyokugo AI v2
- 係数セット：v2-original、v2-tuned-20261021 など。調整ごとに特定できる ID を付けます。
- 配信構成：盤別採用を含む構成の ID。全盤共通の候補と区別します。
- 実行方式：JS / native Rust / WASM。WASM 化だけで AI の世代は変えません。
- 試走：v2 depth=1 など。探索量を減らした v2 を v1 と読み替えません。
