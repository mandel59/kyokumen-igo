# ai-tuner

従来の `dist/engine.js` の `chooseMove`（一手評価 AI の評価関数）の重みを、自己対局で調整するためのツールです。盤・ルール・AI を Rust に移植しており、交点の番号付けと評価は JavaScript 版と一致します。外部クレートは使いません。

```sh
cargo run --release -- selftest            # 盤の構造とルールの確認
cargo run --release -- tune                # 重みの探索（進捗は標準エラー出力）
cargo run --release -- match tuned legacy  # 調整後と調整前の対戦成績
cargo run --release -- parity parity.json  # JS との一致確認用の局面を書き出す
```

- `tune` は交差エントロピー法で重みを探します。各候補を、調整前の重み（`legacy`）とその時点の最良候補の両方と、全 6 種類の盤で先後を入れ替えて対局させ、勝率で評価します。`capture`（取った石 1 個あたり 10）と `noise` は尺度の基準として固定です。
- 結果は `Params::tuned`（`src/ai.rs`）と `AI_WEIGHTS`（`dist/engine.js`）の両方に反映します。そのあと `parity parity.json` で局面を作り直すと、`tests.mjs` が JS 版の選ぶ手と一致することを確認します。

探索条件・比較実験・採用した重みと検証結果は、[2026-10-20 のチューニング記録](TUNING.md) にまとめています。

JS 版と Rust / WASM 版の速度比較は、[WASM ベンチマーク記録](WASM-BENCHMARK.md) を参照してください。

アプリに組み込んだ WASM の範囲と配信物の再生成は、[アプリ用 WASM AI](WASM.md) を参照してください。

従来の一手評価 AI 同士の得点差とコミ別勝率は、[コミの推定記録](KOMI-STUDY.md) を参照してください。

現在アプリで使う最大 4 手の探索 AI と、一手評価 AI によるコミ推定の再検証は [探索 AI の評価](SEARCH-AI.md) にまとめています。

4 手探索版の評価・候補手順位の 13 係数を調整するツールは `search-tune.rs` です。初版の係数を `search::Params::legacy()` に残し、候補は `search::Params::tuned()` に保存し、`search::Params::for_points()` で改善を確認した盤へ採用します。最初の13係数の調整では相性への過適合が見つかったため、最終段階は `robust` モードで一手AIも相手に加え、候補順位を固定して静的評価の5係数を調整しています。方法、独立検証、再現コマンドは [4 手探索のチューニング記録](SEARCH-TUNING.md) を参照してください。
