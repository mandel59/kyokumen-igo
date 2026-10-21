# Kyokugo AI v3 初期実装（2026-10-21）

小型 GNN・ONNX 出力・Worker 内の WebGPU / WASM 推論・バッチ MCTS・自己対局データ生成を実装し、動作と数値一致を確認しました。棋力を検証する対戦実験ではなく、通常対局への採用判定は行っていません。

## 条件と初期モデル

- 64 チャネル × 6 残差ブロック、120,905 パラメータ。FP32 ONNX は 502,401 bytes。
- v2 教師で 6 盤それぞれ 2 局、計 12 局・1,328 局面。seed 20261021。
- この少量試走のコミは各盤 0 / 3.5 のみ。生成器はより多い局数では 6.5 / 9.5 も巡回します。
- 盤ごとに対局単位で分割し、学習 668 局面・検証 660 局面。3 epoch、batch 32、AdamW、lr 0.001。
- 学習 loss は 4.8773 → 3.9701、検証 loss は 4.5793 → 3.8362。分割は学習中の観測用であり、独立した棋力評価ではありません。
- 終局はアプリの面積採点。教師データの打ち切りは 0 局。

## 動作確認

[browser-verification.json](data/browser-verification.json) に実行環境と観測値を保存しています。Edge 155.0.4283.62、Windows、Ryzen 7 3700X、WebGPU adapter は NVIDIA / Blackwell です。

- PyTorch と CPU ONNX の最大絶対差は約 4.8e-7。
- PyTorch とブラウザ WASM の最大絶対差は約 6.0e-7。
- PyTorch と WebGPU の最大絶対差は約 7.2e-7。
- Worker 内で全 6 盤の探索が合法手を返すこと、キャンセルと旧結果の破棄、通常 Worker の `v3-webgpu` 選択を確認。
- 100ms を目安とした空盤試走では、WebGPU が各盤 41–66 回の評価・終局逆伝播を完了。CPU / WASM は 33–34 回。根の評価も回数に含みます。
- 固定 8 スロットに 2 実局面と 6 ダミーを入れた推論は、WebGPU で約 9.6–15.1ms、WASM で約 14.5–17.7ms（各 5 回）。初期化・初回推論は約 1.38 秒 / 0.93 秒。
- 自己対局生成器の torus7・8 simulations・seed 20261022 の試走は 48 手で終局し、48 局面を書き出しました。打ち切り 0。
- 既存のエンジン・v1 / v2 WASM・Worker・UI・保存・棋譜の回帰テストを通過。

時間は少数の開発動作確認の観測値です。独立した性能ベンチマークや端末一般の保証には使いません。学習・データ生成の正確な所要時間は記録していません。

## 保存物と再現

[manifest.json](manifest.json) にソースの base commit・未コミット差分・全保存物の SHA-256 を記録します。学習入力は `data/bootstrap.jsonl.gz`、初期重みは `data/weights.pt`、学習履歴は `data/model-manifest.json`。`data/source.patch` は base commit に適用する実装差分です。

セットアップと再学習は [開発手順](../../../../tools/ai-gnn/README.md) にあります。保存データを展開して同じ学習を行う場合は次を実行します。

```powershell
uv run --project tools/ai-gnn python -c "import gzip,pathlib; pathlib.Path('tools/ai-gnn/target/bootstrap.jsonl').write_bytes(gzip.decompress(pathlib.Path('experiments/ai/v3/2026-10-21-initial/data/bootstrap.jsonl.gz').read_bytes()))"
uv run --project tools/ai-gnn python tools/ai-gnn/train.py --data tools/ai-gnn/target/bootstrap.jsonl --epochs 3 --output tools/ai-gnn/target/reproduced-model
node tools/ai-gnn/test-onnx.mjs tools/ai-gnn/target/reproduced-model
```

モデルの初期化とデータ分割の seed は固定しています。異なるハードウェア・依存版で重みのバイト一致を保証するものではありません。

## 未検証・採用条件

現行配信 v2 との同じ実時間による勝率比較、全コミ範囲、モバイル端末の検証が残っています。この試走は実装確認として事後記録したもので、棋力評価の事前計画ではありません。採用には別の実験 ID で条件・対戦数・seed・盤別の基準を事前に固定した独立評価が必要です。
