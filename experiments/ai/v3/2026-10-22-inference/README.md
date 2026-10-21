# Kyokugo AI v3：推論最適化

同じ FP32 重みで、8 局面の GPU 推論を中央値 **10.9→3.45ms**、1 局面の CPU 推論を **13.9→2.1ms** に短縮しました。300ms の GPU 探索数は **201→573 simulations**。学習・モデルの構造・探索規則は変更していません。

## 実装

- 専用 WGSL：密な `160×160` の行列積を最大 4 隣接点の集計に置き換え、残差ブロックの local / near / ReLU / out / 残差加算を一つのカーネルに融合。全体の集計と文脈計算を含めて 1 ブロック 2 dispatch、全体で 15 dispatch。
- 全 120,905 パラメータを FP32 のまま入力チャネル優先に並べた 483,620 bytes の `weights.f32` を追加。ONNX の SHA-256 と重みファイルの SHA-256 を manifest で照合。元の ONNX の SHA-256 は `e04f00bacc18ebf813095420ea015f2950de37aa8eaadc83b715b6fc126115f5` のまま。
- GPU の重み・中間結果・入出力バッファを再利用。実際に来た局面数だけ dispatch し、通常は Policy / WDL だけを一度の map で読み戻す。盤ごとの隣接行列も再利用。
- CPU は専用 ONNX Runtime WASM を読み込み、動的 batch で実際の局面数だけ評価。1 局面を 8 局面へパディングする計算を除去。
- 専用 GPU の初期化・実行失敗時は同じ ONNX モデルへ戻る。GPU の通常経路では ONNX Runtime 自体を読み込まない。

## 条件と結果

基準はコミット `a02b26a` のコード。固定した元コードを一時 HTTP サーバーがメモリ上で配信し、現在の実装と別 Worker で逐次比較します。基準→候補 / 候補→基準の 2 周。全 6 盤で、合法に再生した異なる 8 局面から実バッチ 1 / 8 を作り、各ケース 5 回ウォームアップ・20 回計測。モデル・コミ・入力・推論精度は同じです。推論時間は特徴抽出を除き、入力の転送と CPU への出力の読み戻しを含みます。

環境は Windows、Edge 155.0.4283.62、NVIDIA Blackwell、Ryzen 7 3700X、Node 26.12.1。各行は 6 盤 × 20 回 × 2 周の時間の中央値です。

| 推論 | 実局面数 | 基準 | 最適化後 | 速度比 |
| --- | --- | --- | --- | --- |
| GPU | 1 | 11.0ms | 3.10ms | 3.55 倍 |
| GPU | 8 | 10.9ms | 3.45ms | 3.16 倍 |
| CPU / WASM | 1 | 13.9ms | 2.10ms | 6.62 倍 |
| CPU / WASM | 8 | 14.3ms | 13.90ms | 1.03 倍 |

300ms 探索は各盤で同じ 3 手の開始局面・seed 3 から 2 回、2 周で 24 測定。GPU の simulations の中央値は 201→573（2.85 倍）、経過時間は約 294.6→298.4ms。CPU は 113→121（1.07 倍）でした。CPU の 8 局面計算はほぼ変わらないため、探索全体への寄与は小さい結果です。探索予算は厳密な上限ではありません。

Worker ごとの初期化＋最初の評価の観測範囲は GPU 1448–1496→192–202ms、CPU 947–1004→370–429ms でした。HTTP・ブラウザ・シェーダーキャッシュを完全に消去した冷起動測定ではありません。

全ケースの native ONNX との最大絶対出力差は約 **0.0000062**。生データは [benchmark.json](data/benchmark.json)、測定環境・集計は [summary.json](data/summary.json) にあります。これは処理速度の比較であり、対局勝率や棋力の評価ではありません。モバイルや他 GPU の速度は未測定です。

## 検証と採用しなかった試作

[ブラウザ検証](data/browser-verification.json) では、PyTorch の全出力、実バッチ数と最大容量 1 / 4 / 8、交点の並べ替え、連続使用時の出力、同時実行の拒否、重み破損時・最大 4 隣接を超えた時の ONNX フォールバック、全 6 盤の探索、終盤のパス、キャンセル、実際の Worker の v3 選択を確認しました。Python では全 FP32 パラメータの配置とモデルのパディング・置換同変性を確認しました。既存の WASM / ONNX / UI の検証も実行しています。

初期に ONNX Runtime 1.30.0 の Graph Capture を試し、同じ入力の繰り返しでは時間が短縮しましたが、入力・盤・実バッチを切り替える検証で最大約 1.85 の出力差を観測したため採用しませんでした。JSPI の試作も、この環境の Worker で実行時に停止したため採用していません。専用 WGSL はこれらを使いません。上流にも Graph Capture の出力不一致の [報告](https://github.com/microsoft/onnxruntime/issues/29594) がありますが、今回と同じ原因とは特定していません。

## 再現

```powershell
npm ci --prefix tools/ai-gnn
node tools/ai-gnn/prepare.mjs
node tools/ai-gnn/bench-inference.mjs --baseline a02b26a --iterations 20 --rounds 2 --output tools/ai-gnn/target/inference-benchmark.json
node tools/ai-gnn/test-browser.mjs --output tools/ai-gnn/target/browser-verification.json
uv run --project tools/ai-gnn --extra cuda python tools/ai-gnn/test_model.py
node tools/ai-gnn/test-onnx.mjs
node v3-tests.mjs
```

CUDA を使わない場合は uv の `--extra cuda` を外して実行できます。基準コードを読むために Git 履歴が必要です。実行時のソース差分は [source.patch](data/source.patch)、成果物のハッシュは [manifest.json](manifest.json)、現在の仕様は [v3](../../../../docs/ai/architectures/v3.md) を参照してください。
