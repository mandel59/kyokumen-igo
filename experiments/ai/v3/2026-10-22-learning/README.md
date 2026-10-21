# v3 の学習改善と不採用候補

学習経路を改善し、3 通りの追加学習を比較しました。検証指標は改善しましたが、選んだ候補 B は独立した開始局面での採用基準を満たさず、**配信中の重みを維持**します。モデル構造・特徴・探索ルール・推論最適化は同じです。

## データと学習

- 旧教師データ：144 局・16,365 局面。[出所と元チェックポイント](../2026-10-21-strength/README.md)。
- 新しい自己対局：6 盤 × 16 局、計 96 局・10,079 局面。seed 20261220、128 visits、コミ 0 / 3.5 / 6.5 / 9.5、打ち切り 0。
- 終盤教材：同じ自己対局の 43 対局から 177 局面。相手が取り進めた後にも敗北を証明できる根でパスを教え、合法に終局した枝の得点と所属を使います。報告されたユーザー棋譜は教材に含めません。
- 全 26,621 局面を、学習 22,018・検証 4,603 に分割。旧モデルの分割を固定し、新規対局だけを分けます。枝は元の対局 ID を共有し、学習と検証をまたぎません。
- 序盤の探索には Dirichlet ノイズと温度抽選を使います。学習ではデータ源・盤・対局・進行度を均等化し、CUDA 上のテンソルを再利用、cosine 学習率と EMA を使います。検証最良の選択には epoch 0 も含めます。

| 候補 | 設定 | 選択 epoch | 開発用 24 局 |
| --- | --- | ---: | ---: |
| A | 自己対局比率 70%、学習率 3e-4 | 24 | 7 勝 17 敗 |
| B | 比率 50%、学習率 1e-4、着手教師の温度 0.5、最大訪問比率 0.25 未満では着手損失を抑制、旧 prior への KL 係数 0.5 | 16 | 13 勝 11 敗 |
| C | 比率 70%、勝敗ヘッドだけ更新 | 0 | 更新前が選択されたため比較対象外 |

各候補は同じ旧チェックポイントから再開し、24 epochs、batch 128、EMA 0.99。C は出力モデルの全パラメータと ONNX が旧モデルに一致することを検証しました。重複する対戦を途中で停止し、その部分結果も保存しています。

B の元の訪問分布に対する Top-1 は 52.6→51.8%、Top-5 は 83.8→85.5%。勝敗精度は 72.4→74.8%、Brier は 0.349→0.341、得点 MAE は 26.0→23.5 点、パス再現率は 56.6→75.2% でした。A は損失が下がっても対戦で弱くなりました。低訪問数の拡散した着手教師への追従が一因の可能性がありますが、原因を切り分けた実験ではありません。B の損失は教師の変換・抑制・KL を含むため、A の損失とは直接比較できません。

## 独立した最終対戦

開発 seed 20261240 の結果を見て B を選んだため、開発対戦は独立評価と呼びません。最終評価は未使用の seed 20261250、各盤 4 開始配置を先後交換、48 局。4 手のランダム開始、コミ 6.5、両者 128 visits、同じ戦術・敗北確定パス判定、CPU ONNX 推論です。敗北確定時だけ最初の評価で停止します。ブラウザの同時間対戦ではありません。

B は **19 勝 29 敗（39.6%）**、打ち切り 0。開始配置の先後交換ペアを単位に盤ごとに層別した bootstrap（10,000 回、seed 20261251）の記述的 95% 区間は 27.1%–52.1% でした。24 ペア・固定した 6 盤の小規模比較です。

| 盤 | B の勝数 / 8 局 |
| --- | ---: |
| sphere3 | 3 / 8 |
| sphere4 | 2 / 8 |
| sphere5 | 3 / 8 |
| torus7 | 3 / 8 |
| torus9 | 3 / 8 |
| torus11 | 5 / 8 |

学習候補の序盤パスは 0 回。敗北確定によるパスは B 120 回、旧モデル 54 回で、旧モデルに負けた対局が多い影響を含みます。現在の面積で負けており敗北未確定のパスは 33 対 26 回でした。単純なパス数の増加を改善とは判断しません。

事前の採用条件は 30 / 48 点以上、各盤 2 / 8 点以上、打ち切りなし、推論・終盤検証の通過です。結果を見て閾値を変更していません。開発と最終評価の両方に失敗候補を残し、最終 seed を再調整には使いません。

## 検証と所要時間

学習の 8 テスト、Dirichlet・温度抽選、全 6 盤の ONNX / MCTS、既存の終盤 33 局面の回帰検証が通過しました。候補 B は配信を変更せず実 Edge の専用 WebGPU と WASM でも検証し、PyTorch との最大出力差は約 0.000003。実バッチ 1 / 4 / 8、並べ替え、フォールバック、キャンセル、本番 Worker、終盤のパスも通過しました。[ブラウザ結果](data/candidate-b-browser.json)。

ログ作成から最終更新までの概算では、自己対局生成が約 13.5 分、24 epochs の追加学習は A 約 126 秒、B 約 120 秒、C 約 90 秒。Ryzen 3700X、CUDA 対応 NVIDIA GPU、PyTorch 2.14.1+cu130 を使用しています。旧学習との速度比較ではありません。[時刻記録](data/timings.json)。

## 再現

[計画と実行前の追記](data/plan.json)、[集計](data/summary.json)、[選定](data/selection.json)、[アーカイブ一覧と SHA-256](manifest.json) を保存しています。`stage-a-source.patch`、`stage-b-source.patch` は各学習時点、`source.patch` は最終実装の差分です。全候補の ONNX・FP32・PT・golden・モデル manifest とログ、自己対局と終盤教材の gzip を保持します。試走 12 局は学習に含めません。

リポジトリのルートで、候補 B の学習を再実行できます。初めに [開発手順](../../../../tools/ai-gnn/README.md) の依存・トポロジーを用意します。CUDA の演算環境によって再学習時のビット一致は保証しません。

```powershell
$oldData = 'experiments/ai/v3/2026-10-21-strength/data'
$newData = 'experiments/ai/v3/2026-10-22-learning/data'
$learningData = @(Get-ChildItem -LiteralPath $oldData -Filter 'data-*.jsonl.gz' | ForEach-Object FullName)
$learningData += @("$newData/selfplay.jsonl.gz", "$newData/cleanup.jsonl.gz")
uv run --project tools/ai-gnn --extra cuda python tools/ai-gnn/train.py --data $learningData --resume "$oldData/weights.pt" --split-manifest "$newData/baseline-model-manifest.json" --device cuda --epochs 24 --batch-size 128 --seed 20261230 --learning-rate 0.0001 --minimum-learning-rate 0.00001 --cosine --ema-decay 0.99 --balanced --selfplay-mass 0.5 --policy-temperature 0.5 --minimum-policy-confidence 0.25 --policy-anchor "$oldData/weights.pt" --policy-anchor-weight 0.5 --best-validation --output tools/ai-gnn/target/reproduced-b
node tools/ai-gnn/test-browser.mjs --model tools/ai-gnn/target/reproduced-b --output tools/ai-gnn/target/reproduced-browser.json
node experiments/ai/v3/2026-10-22-learning/data/reproduce-summary.mjs
```

保存済みの B を直接再評価する場合は、`candidate-b-` を除いて `manifest.json`、`model.onnx`、`weights.f32`、`weights.pt`、`golden.json` を target 内の候補ディレクトリへコピーします。対戦の相手も旧モデルをコピーしたディレクトリに固定します。`match.mjs --a <候補> --b <旧モデル> --pairs 4 --simulations 128 --seed 20261250 --output <新しい結果>` で追試できます。過去の測定ファイルは上書きしません。

今回は教材と学習・検証経路の改善を残し、強くなったという主張は行いません。次の比較では、探索教師の訪問数、確信度、終盤教材の比率を個別に比較する必要があります。
