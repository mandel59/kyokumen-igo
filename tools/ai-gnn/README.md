# Kyokugo AI v3 開発

64 チャネル・6 ブロック、120,905 パラメータのグラフ NN と、Rust / WASM のバッチ MCTS です。[仕様](../../docs/ai/architectures/v3.md)、[再学習と診断対戦](../../experiments/ai/v3/2026-10-21-strength/README.md)、[初期検証](../../experiments/ai/v3/2026-10-21-initial/README.md) を参照してください。固定探索回数の診断で改善を確認したモデルを実験用に配置しています。同じ実時間でのブラウザ比較は未実施です。

## セットアップと試走

リポジトリのルートで実行します。Python は uv で管理します。Rust の `wasm32-unknown-unknown` ターゲットと Node.js も必要です。

```powershell
uv sync --project tools/ai-gnn --locked
npm ci --prefix tools/ai-gnn
node tools/ai-gnn/prepare.mjs
node tools/ai-gnn/build.mjs
uv run --project tools/ai-gnn python -m http.server --directory dist 8000
```

`http://localhost:8000/?ai=v3` を開きます。CPU 推論は `?ai=v3&backend=wasm`。初期化中の手番は v2 が担当します。通常の URL は v2 のままです。

`prepare.mjs` は固定バージョンの ONNX Runtime Web とライセンスを `dist/vendor/onnxruntime/` に用意します。この生成ディレクトリは Git 管理外です。v3 を配信する際も事前に prepare を実行し、生成物を含めて `dist/` を配信します。推論時に外部 CDN や AI サーバーへ接続しません。

## 初期データ生成と学習

```powershell
tools/ai-gnn/target/gnn-data.exe tools/ai-gnn/target/bootstrap.jsonl 20 20261021
uv run --project tools/ai-gnn python tools/ai-gnn/train.py --data tools/ai-gnn/target/bootstrap.jsonl --epochs 10 --output tools/ai-gnn/target/model
node tools/ai-gnn/test-onnx.mjs tools/ai-gnn/target/model
node tools/ai-gnn/install-model.mjs tools/ai-gnn/target/model
```

Unix では生成器名の `.exe` を省略します。数値 `20` は盤ごとの対局数です。全 6 盤を扱い、コミ 0 / 3.5 / 6.5 / 9.5 を巡回します。6 手目まで確率 25% で合法手をランダムに選び、教師の着手を学習ターゲットとして保持します。点数の 20 倍の手数で打ち切った局は、終局ラベルに使いません。

データは 1 行 1 局面の JSONL。特徴 ABI、盤、対局 ID、合法手、着手（または探索訪問分布）、最終勝敗・得点・所属を保存します。盤ごとに対局 ID を分割し、同じ対局を学習と検証に混在させません。各盤 2 局以上の終局データが必要です。

`train.py` は ONNX、専用 WebGPU 用の FP32 `weights.f32`、再開用 `weights.pt`、入出力の `golden.json`、学習履歴と SHA-256 を含む `manifest.json` を出力します。`--resume` は自分で生成したローカルチェックポイントを指定します。既定では CPU で実行します。

CUDA 対応 GPU がある場合は、uv の追加依存を指定して学習できます。

```powershell
uv sync --project tools/ai-gnn --extra cuda
uv run --project tools/ai-gnn --extra cuda python tools/ai-gnn/train.py --data tools/ai-gnn/target/bootstrap.jsonl --device cuda --epochs 30 --batch-size 128 --best-validation --output tools/ai-gnn/target/candidate
```

`--best-validation` は対局を分けた検証データの損失が最小だった epoch を出力します。モデル選択に使った検証値は独立した棋力評価ではありません。CPU は既定のまま利用でき、CUDA 版を使うコマンドには `--extra cuda` を付けます。

`install-model.mjs` は実験用の `dist/models/v3/` と数値照合用固定入力を更新します。通常対局のモデルを切り替える操作は行いません。

## 自己対局からの改善

```powershell
node tools/ai-gnn/selfplay.mjs --model tools/ai-gnn/target/model --games 10 --simulations 128 --seed 20261022 --output tools/ai-gnn/target/selfplay.jsonl
uv run --project tools/ai-gnn python tools/ai-gnn/train.py --data tools/ai-gnn/target/bootstrap.jsonl tools/ai-gnn/target/selfplay.jsonl --resume tools/ai-gnn/target/model/weights.pt --output tools/ai-gnn/target/next-model
```

Node の CPU ONNX Runtime と配信 WASM の探索を組み合わせ、訪問分布を教師にします。最初の 12 手は探索分布から着手を抽選し、根の logits に乱数を加えます。`--board torus7` のように盤を限定できます。打ち切り局は除外します。棋力評価や過去モデルとのリーグ戦は別途必要です。

## 検証

```powershell
node v3-tests.mjs
uv run --project tools/ai-gnn python tools/ai-gnn/test_model.py
node tools/ai-gnn/test-onnx.mjs
node tools/ai-gnn/test-browser.mjs
```

ブラウザ検証はローカルサーバーと一時プロファイルのヘッドレス Edge を起動し、Worker 内の専用 WebGPU / WASM を PyTorch の固定出力と比較します。実バッチ数・最大容量 1 / 4 / 8、交点の並べ替え、破損重み・未対応グラフからの ONNX フォールバック、6 盤での MCTS、終盤、キャンセル、実際の Worker の v3 選択も検証します。Windows の既定 Edge パス以外では環境変数 `EDGE_PATH` を指定してください。`--output <file.json>` で環境と観測時間を保存できます。

## 推論速度の比較

```powershell
node tools/ai-gnn/bench-inference.mjs --baseline a02b26a --iterations 20 --rounds 2 --output tools/ai-gnn/target/inference-benchmark.json
```

指定コミットの推論コードをメモリ上で配信し、作業ツリーを変えずに現在の実装と比較します。全 6 盤・実バッチ 1 / 8 のアップロードと読み戻しを含む時間を計測し、各盤の異なる 8 局面の出力を native ONNX と照合します。別 Worker で逐次実行し、2 周目は実行順を逆にします。300ms の MCTS 探索数も保存します。これは処理速度の測定で、対局勝率の評価ではありません。

既存のチェックポイントに補助重みだけを追加する場合は、同じ ONNX と固定入出力の組を用意して次を実行します。

```powershell
uv run --project tools/ai-gnn --extra cuda python tools/ai-gnn/export_webgpu.py --weights experiments/ai/v3/2026-10-21-strength/data/weights.pt --directory dist/models/v3 --golden tests/fixtures/ai/v3-golden.json
```

固定出力でチェックポイントを照合してから `weights.f32` と manifest の補助情報を作ります。専用推論は転置した FP32 重みを使い、再学習や量子化は行いません。`createV3Inference({accelerator:false})` で ONNX 経路を直接比較できます。以前の形式のモデルも ONNX で動作します。[最適化の測定記録](../../experiments/ai/v3/2026-10-22-inference/README.md) を参照してください。

従来の `node tests.mjs`、`node wasm-tests.mjs`、`node search-tests.mjs`、`node ui-tests.mjs` なども継続して実行します。

## 棋力の診断対戦

```powershell
node tools/ai-gnn/match.mjs --a tools/ai-gnn/target/candidate --b v2 --pairs 2 --simulations 128 --seed 20261140 --output tools/ai-gnn/target/match.json
```

全 6 盤で同じ 4 手の初期配置から先後を交換します。`--b` に別のモデルディレクトリを指定すると GNN 同士でも比較できます。`--board torus7` のように盤を限定できます。全棋譜、盤別得点率、打ち切り、探索回数、計算時間などを記録します。v3 の固定探索回数と v2 の深さ 4 を比べる診断であり、ブラウザの同じ実時間での評価ではありません。

v3 の戦術チェックは既定で有効です。同じモデルで有無を比較する場合は `--a-tactics safe --b-tactics none` を指定します。根の特徴抽出・戦術チェックのみの開発用計測は `node tools/ai-gnn/bench-tactics.mjs` で実行できます。

相手の生き石だけで逆転不能と確認できる局面ではパスを選びます。`createV3Search().start(position,{endgame:false})` でこの判断だけを無効化できます。`node tools/ai-gnn/replay-endgame.mjs --output tools/ai-gnn/target/endgame-replay.json` は報告された実棋譜の同じ局面・モデル・seed を使い、この判断の有無を比較します。`tactics` と `endgame` は独立した開発用設定です。
