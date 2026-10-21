# Kyokugo AI の固定局面

[v1-parity.json](v1-parity.json) は Kyokugo AI v1 の調整済み係数による 300 局面です。乱数加点を 0 にした選択手を JS / native / WASM 間で照合するために使います。過去の tools/ai-tuner/parity.json から内容を保って移しました。

Kyokugo AI v2 の回帰テストは、係数の採用状態に対応する実験の代表棋譜を参照します。実験データを固定局面へ複製せず、出所を残します。

[v3-golden.json](v3-golden.json) は現在の v3 実験モデルの PyTorch 入出力とモデル SHA-256 です。モデルの差し替え時に同時に更新し、ONNX / WASM / WebGPU の数値照合に使います。[v3 仕様](../../../docs/ai/architectures/v3.md) を参照してください。

[v3-endgame.json](v3-endgame.json) はユーザーから報告された、白 AI がパス後に無意味な着手を再開する実棋譜です。球面 5、コミ 6.5、231 手。`v3-tests.mjs` が 166 手目以降の白番 33 局面でパスを確認し、ブラウザ検証でも代表局面を再生します。

- [v1 仕様](../../../docs/ai/architectures/v1.md)
- [v2 仕様](../../../docs/ai/architectures/v2.md)
- [実験索引](../../../experiments/ai/README.md)
