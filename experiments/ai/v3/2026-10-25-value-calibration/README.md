# 勝敗ヘッドだけの追加学習

同じ64チャネル・6ブロック・120,905パラメーターのまま、勝敗評価の4,867パラメーターだけを追加学習しました。着手方策を含む残り60テンソルは完全一致し、固定入力の着手・得点・所属の出力も完全一致しました。速度基準は通りましたが、独立192局は102勝90敗、95%区間46.9〜59.4%で棋力基準に届かなかったため、重みを不採用とし配信モデルを維持します。

## 学習と選抜

[計画](plan.json)を学習前に固定し、既存の通常局面の教師・第1世代・第2世代自己対局を使いました。入力は2026-10-22の学習実験に固定された3つのgzipで、SHA-256と対局分割は計画とモデルmanifestに保存しています。今回の棋力評価の棋譜は学習に使っていません。

現在のround1-t0チェックポイントから再開し、非valueパラメーターを凍結。CUDA、24 epochs、batch 128、学習率1e-4→1e-5のcosine、EMA 0.99、教師50%・自己対局50%、自己対局世代は均等です。敗北確定局面を除外し、旧対局分割を固定しました。epoch 0と4の倍数から通常局面の共通教師による検証損失で選び、24が選択されました。着手・得点・所属の損失項は凍結により一定なので、この選抜の差は勝敗評価によるものです。

正常局面の勝敗Brierは0.3934→0.3823、勝敗精度は69.5→71.0%。学習は155.78秒でした。学習指標の改善を棋力改善と同一視しないため、選択後の重みを固定して新しいseedで対戦しました。

## 独立評価と速度

未使用seed 2026102561、各盤16開始配置を先後交換、全192局。コミ6.5、開始4手はランダム、通常手は厳密に64訪問、敗北確定時だけ早期パス、手数上限は交点数の20倍です。両者FPU 1・探索係数1.5、専用WGSL WebGPUの実Workerで逐次対戦しました。候補には評価待ちの重複を避ける従来の仮想負け方式を使い、予約値平均の変更は使いません。この重複回避だけを旧モデルで比較した開発48局は24勝24敗でした。したがって今回の対戦は学習済み評価と重複回避を組み合わせた構成の比較です。

| 盤 | 候補の勝数 / 32局 |
| --- | ---: |
| sphere3 | 20 |
| sphere4 | 13 |
| sphere5 | 18 |
| torus7 | 12 |
| torus9 | 21 |
| torus11 | 18 |

引き分け0、打ち切り0。先後交換ペア単位・盤別層別bootstrapを10,000回（seed 2026102562）行い、95%区間は46.9〜59.4%でした。事前基準は区間下端50%超・各盤12/32点以上・違法手と打ち切りなしです。今回の評価による学習設定の再調整や対局追加は行っていません。

速度は同じ18局面・seedを両構成に使い、2回のウォームアップ後7回、順序を交互にしてCPU/WASMとWebGPUを測定しました。全体P95はCPU171.3→168.2ms、WebGPU40.0→38.5ms。全体1.05倍以内・各盤1.10倍以内を両バックエンドで通過しました。初期化・描画を除く実着手呼び出しの時間で、履歴復元・探索・推論・待機を含みます。Pixel 8aの再実測ではありません。

## 検証と再現

[重み凍結の照合](data/freeze-verification.json)、[全速度計測](data/speed.json)、[実ブラウザー検証](data/browser-verification.json)を保存しています。PyTorch / ONNX / WebGPUの最大出力差は約0.00000191、実バッチ1/4/8、全6盤の合法手、スーパーコウ、終盤、キャンセル、初回Workerの64訪問を検証しました。モデル容量はONNX 502,401 bytes、FP32 483,620 bytesで変わりません。

[実行コマンド・学習ログ](data/training-command.json)、[学習ログ](data/training-log.txt)、[選択](data/selection.json)、[集計](data/summary.json)、[全棋譜](data/evaluation.json.gz)、[ハッシュ目録](manifest.json)があります。基準commitは77dd92ab74f9af8139f380835ceec4f881c1b166。基準コードとの差分は[data/source.patch](data/source.patch)、候補探索の全ソースは[data/search/candidate-mcts.rs](data/search/candidate-mcts.rs)です。旧モデル・候補モデル・epoch 0/4/8/12/16/20/24の重みをdata内へ固定しました。再学習時のビット一致はCUDA環境によって保証しません。

```powershell
node tools/ai-gnn/browser-match.mjs --a experiments/ai/v3/2026-10-25-value-calibration/data/candidate-model --b experiments/ai/v3/2026-10-25-value-calibration/data/baseline-model --a-wasm experiments/ai/v3/2026-10-25-value-calibration/data/search/candidate.wasm --b-wasm experiments/ai/v3/2026-10-25-value-calibration/data/search/baseline.wasm --a-fpu 1 --b-fpu 1 --pairs 16 --simulations 64 --seed 2026102561 --output tools/ai-gnn/target/value-calibration-recheck.json
```

再評価の出力先は新しいtargetファイルにし、保存済みの実験結果へ上書きしません。
