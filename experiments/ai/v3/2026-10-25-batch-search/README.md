# 64訪問のバッチ探索と予約値の比較

球面盤で予約中の架空の負けを値の平均に加えない候補を評価しました。最終192局は101勝91敗（52.6%）、先後交換ペア単位・盤別層別bootstrapの95%区間は47.9〜57.3%でした。事前の棋力基準を満たさず、この探索方式の変更は採用しません。学習モデルと標準64訪問は維持します。

## 計画と変更履歴

[当初計画](data/initial-plan.json)は、評価待ちの枝を重複して選ばない候補と、それに予約値の平均を加えた候補を各48局で比較するものです。開発seedは2026102531。両候補とも探索係数1.5、FPU 1、コミ6.5、4手のランダム開始、上限は交点数の20倍でした。

予約値平均の開発結果に球面・トーラスの差が出たため、2番目の候補の結果を参照する前、独立評価前に[計画](plan.json)へ盤別選抜を追記しました。各盤で高得点の候補が5/8点以上の場合だけ採用候補にし、同点では従来の仮想負けを優先、両候補とも4/8点以下なら現状維持としました。

開発結果は予約値平均が29勝19敗、重複回避だけが24勝24敗でした。球面3・4・5の予約値平均は7/8、5/8、6/8点、トーラス7・9・11は4/8、3/8、4/8点。固定した[構成](data/selection.json)は球面だけを変更し、トーラスは従来の値と経路選択を保ちました。

## 独立評価と速度

未使用seed 2026102541、各盤16開始配置を先後交換、計192局を実Worker・専用WGSL WebGPUで実行しました。評価途中の調整や局数追加はありません。棋力基準は108/192点以上・各盤12/32点以上・95%区間の下端50%超・違法手と打ち切りなしです。

| 盤 | 候補の勝数 / 32局 |
| --- | ---: |
| sphere3 | 15 |
| sphere4 | 18 |
| sphere5 | 20 |
| torus7 | 16 |
| torus9 | 16 |
| torus11 | 16 |

引き分け0、打ち切り0。球面だけの集計でも採用を裏付ける確実な優位には届いていません。トーラスの全ペアは1勝ずつで、変更しない構成が再現できています。

速度は固定した18局面・同一seedで順序を交互にし、各局面2回のウォームアップ後7回、CPU/WASMとWebGPUを別Workerで計測しました。64訪問、同じモデル、容量8のバッチです。全体P95が旧版の1.05倍以内・各盤1.10倍以内を基準にしました。CPUの全体P95は172.7→171.6ms、WebGPUは38.3→38.0msで両方通過しました。初期化と描画は含まず、実際の着手呼び出し・履歴復元・探索・推論・待機を含みます。Pixel 8aの再実測ではありません。[全計測](data/speed.json)に盤別値とバッチ数があります。

## 検証と保存

強いpriorと悲観的な根評価により、評価待ちの1枝を選び続けて8局面のバッチが1局面しか埋まらない問題を旧版で再現しました。[旧版での失敗](data/baseline-regression.json)と、候補での回避・経路予約の解放・キャンセル・訪問上限のテストを保存しています。最終候補のRustテストは10件通過しました。WASMの既存v3回帰も通過しました。

[集計・実行条件](data/summary.json)、[全棋譜](data/evaluation.json.gz)、[候補バイナリーとソース](data/variants/)、[ハッシュ目録](manifest.json)を保持します。ソース基準は77dd92ab74f9af8139f380835ceec4f881c1b166で、当時のコード差分は[data/source.patch](data/source.patch)です。新しい計測ツールは[data/source/tools/ai-gnn/bench-search.mjs](data/source/tools/ai-gnn/bench-search.mjs)にも固定しました。比較相手は[直前の終局判定修正](../2026-10-25-search-proof/README.md)を含むv3です。

```powershell
node tools/ai-gnn/browser-match.mjs --a dist/models/v3 --b dist/models/v3 --a-wasm experiments/ai/v3/2026-10-25-batch-search/data/variants/selected.wasm --b-wasm experiments/ai/v3/2026-10-25-batch-search/data/variants/baseline.wasm --pairs 16 --simulations 64 --seed 2026102541 --output tools/ai-gnn/target/batch-search-recheck.json
node tools/ai-gnn/bench-search.mjs --a-wasm experiments/ai/v3/2026-10-25-batch-search/data/variants/selected.wasm --b-wasm experiments/ai/v3/2026-10-25-batch-search/data/variants/baseline.wasm --output tools/ai-gnn/target/batch-speed-recheck.json
```

実行時の着手時間は生データにありますが、ビルド・開発・独立評価の壁時計による総時間は記録していません。改善を確認できなかった設定を配信用WASMへ反映していません。
