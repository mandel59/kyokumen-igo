# v2 の敗北確定パスと判定処理の共通化

v3 の Benson 生存判定と敗北確定の式を `endgame.rs` に分離し、v2 の探索前にも適用しました。報告された球面 5・白 AI の棋譜で、深さ 4 の v2 が続行していた 31 局面はすべてパスになりました。

## コードの配置

- [endgame.rs](../../../../tools/ai-tuner/src/endgame.rs)：共有の生存判定と、相手の生存石だけで逆転不能となる十分条件。
- [search.rs](../../../../tools/ai-tuner/src/search.rs)：v2 のルートで共有判定を呼び、成立時は探索せずパス。
- [mcts.rs](../../../../tools/ai-tuner/src/mcts.rs)：v3 のルートで同じ共有判定を使用。
- [tactics.rs](../../../../tools/ai-tuner/src/tactics.rs)：v3 の打ち込み回避・捕獲読み。生存判定は共有モジュールから取得。

共有した計算本体は変更前 v3 と一致しています。v2 は戦術用の `tactics.rs` を取り込まず、必要な `endgame.rs` だけを参照します。v2 のネイティブ対局・調整・GNN 教師データ生成でも同じ判定を使います。係数・探索中の評価・ルール・採点・JS 版 v1 は維持しています。

## 条件と検証

相手の Benson 生存石を `E`、交点数を `N` として、自分が黒なら `2E + コミ > N`、白なら `2E - コミ > N` のときパスします。相手が生きを維持する限り、残りを全て自分の得点にしても勝てない条件です。引き分けが残る等号と、生存未確定の石はこの条件に含めません。

| 探索の深さ | 元の 33 局面での続行数 | 修正後 |
| --- | ---: | ---: |
| 1 | 27 | 0 |
| 2 | 33 | 0 |
| 3 | 33 | 0 |
| 4 | 31 | 0 |

同じ棋譜の 166–230 手目にある白番 33 局面を、同じ seed 3、深さ 1–4 で比較しました。直前の 164 手目の着手は変更前と一致します。入力の棋譜と局面は変更していません。[前後比較](data/replay.json)。

既存の代表対局 1,257 手（うち探索 629 手）も再生しました。47 回の敗北確定ルートではパス、それ以外では保存済みの native / WASM の選択手と一致します。全 6 盤・両手番・引き分け境界・逆転余地のある生存群・未確定の囲い・入力の不変性を Rust で検証しました。v2 の 9 テスト、v3 の 5 テスト、JS / WASM の既存回帰と実ブラウザ検証が通過しています。[検証集計](data/verification.json)、[ブラウザ結果](data/browser.json)。

これは同一局面でのパス判定の回帰検証です。新しい対局による勝率測定は行っていません。

## 再現

[計画](data/plan.json)、[変更前 WASM](data/baseline.wasm)、[ソース差分](data/source.patch)、[出所とハッシュ](manifest.json) を保存しています。モデルの再学習は行いません。

```sh
node tools/ai-tuner/build-wasm.mjs
node tools/ai-gnn/build.mjs
node search-tests.mjs
node v3-tests.mjs
node wasm-tests.mjs
node tools/ai-tuner/replay-endgame.mjs --baseline experiments/ai/v2/2026-10-22-endgame/data/baseline.wasm --output tools/ai-tuner/target/v2-endgame-replay.json
```

[v2 の仕様](../../../../docs/ai/architectures/v2.md) / [元の v3 終盤修正](../../v3/2026-10-22-endgame/README.md)
