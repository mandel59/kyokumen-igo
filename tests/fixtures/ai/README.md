# Kyokugo AI の固定局面

[v1-parity.json](v1-parity.json) は Kyokugo AI v1 の調整済み係数による 300 局面です。乱数加点を 0 にした選択手を JS / native / WASM 間で照合するために使います。過去の tools/ai-tuner/parity.json から内容を保って移しました。

Kyokugo AI v2 の回帰テストは、係数の採用状態に対応する実験の代表棋譜を参照します。実験データを固定局面へ複製せず、出所を残します。

- [v1 仕様](../../../docs/ai/architectures/v1.md)
- [v2 仕様](../../../docs/ai/architectures/v2.md)
- [実験索引](../../../experiments/ai/README.md)
