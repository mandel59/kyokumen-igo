# ai-tuner

`dist/engine.js` の `chooseMove`（AI の評価関数）の重みを、自己対局で調整するためのツールです。盤・ルール・AI を Rust に移植しており、交点の番号付けと評価は JavaScript 版と一致します。外部クレートは使いません。

```sh
cargo run --release -- selftest            # 盤の構造とルールの確認
cargo run --release -- tune                # 重みの探索（進捗は標準エラー出力）
cargo run --release -- match tuned legacy  # 調整後と調整前の対戦成績
cargo run --release -- parity parity.json  # JS との一致確認用の局面を書き出す
```

- `tune` は交差エントロピー法で重みを探します。各候補を、調整前の重み（`legacy`）とその時点の最良候補の両方と、全 6 種類の盤で先後を入れ替えて対局させ、勝率で評価します。`capture`（取った石 1 個あたり 10）と `noise` は尺度の基準として固定です。
- 結果は `Params::tuned`（`src/ai.rs`）と `AI_WEIGHTS`（`dist/engine.js`）の両方に反映します。そのあと `parity parity.json` で局面を作り直すと、`tests.mjs` が JS 版の選ぶ手と一致することを確認します。
