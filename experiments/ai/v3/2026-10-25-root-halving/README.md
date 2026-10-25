# 64訪問の根の逐次半減探索

モデルと標準の64訪問を維持し、根の最大8候補を逐次半減する探索を採用しました。従来のPUCT探索に独立192局で117勝75敗（60.9%）、先後交換ペア単位の層別bootstrapによる95%区間は55.2〜66.7%。全6盤で勝ち越し、打ち切り・違法手は0です。固定18局面のCPU/WASM・WebGPU計測で、待ち時間を維持する基準も通過しました。

## 識別と実行前計画

対象はKyokugo AI v3、モデルSHA-256は8e5b41e3974cbd30349fa483bb8a3a0f5c055ea9bb6cddef82c63b69b88b4b9a。64チャネル・6ブロック・120,905パラメーター、ONNX 502,401 bytes、FP32 483,620 bytesを維持します。特徴ABI 1と探索ABI 3も同じです。比較相手は[直前の終局判定修正](../2026-10-25-search-proof/README.md)を含む従来PUCTで、両者ともFPU 1・内部PUCTの探索係数1.5・同じ重みを使います。

[計画](plan.json)を実行前に保存しました。開発seedは2026102571、8候補と16候補を各48局、盤ごと4開始配置を先後交換して比較します。高得点を選び、同点なら8候補を優先。選択後は未使用seed 2026102581の192局（盤ごと16開始配置×先後）で固定構成を評価します。コミ6.5、開始4手は合法手からランダム、手数上限は交点数の20倍です。

棋力基準は95%区間の下端50%超・各盤12/32点以上・違法手と打ち切りなし。速度基準は同一18局面でCPU/WASM・WebGPUの全体P95が旧版の1.05倍以内、各盤1.10倍以内です。開発結果を独立評価として扱わず、独立評価中の設定変更や局数追加は行っていません。

## 実装と選抜

[Danihelkaらの論文](https://openreview.net/forum?id=bERaNdoegnO)を参考に、根だけで候補を逐次半減する独立実装です。Gumbel乱数は使わず、内部ノードはPUCTを保ちます。参考実装の[評価用の設定](https://github.com/google-deepmind/mctx/blob/main/mctx/_src/policies.py)も参照しました。Full Gumbel AlphaZeroの実装や、論文で報告された棋力の再現を主張するものではありません。

根の事前確率が高い候補を選び、各段階の訪問を配分して候補を半分ずつに絞ります。段階の予算を8評価のバッチに揃え、最後の端数を残った候補へ配分します。比較値は log(prior) + 0.1 × (50 + 根の最大訪問数) × Q。最終手は残った候補の比較値で決め、有限予算時のpolicyはその正規化分布です。生の訪問数はdiagnostics.rawVisitsに残ります。確定した勝ち・負けを優先する既存の修正も維持します。

評価待ちの枝と、そのバッチで探索先が尽きた枝を重複して選ばず、可能な限りバッチを埋めます。最初のcollectに全体予算を指定した場合に根の逐次半減を使い、上限なしのcollectは従来PUCTです。途中で全体予算が変わる呼び出しはPUCTへ戻す互換動作を、独立評価前に追加しました。固定64訪問の計算式・候補数はその際に変更していません。

開発結果は8候補が34勝14敗（70.8%）、16候補が28勝20敗（58.3%）。[選抜](data/selection.json)で8候補を固定し、全盤へ同じ方式を適用しました。盤別に都合のよい結果を選ぶ構成は使っていません。

## 独立評価

| 盤 | 採用候補の成績 / 32局 |
| --- | ---: |
| sphere3 | 19勝13敗 |
| sphere4 | 20勝12敗 |
| sphere5 | 19勝13敗 |
| torus7 | 22勝10敗 |
| torus9 | 20勝12敗 |
| torus11 | 17勝15敗 |

合計117勝75敗、引き分け0、打ち切り0。実Worker内の専用WGSL WebGPUで両者を逐次実行し、敗北確定による早期パス以外は厳密に64訪問に一致することを各手で検査しました。全6盤の開始配置ペアを単位に、盤ごとに層別して10,000回bootstrap（seed 2026102582）した95%区間は55.2〜66.7%です。[全棋譜・各手の訪問数とバックエンド](data/evaluation.json.gz)と[集計](data/summary.json)を保存しています。

## 待ち時間と検証

同じ18局面・同じseedで、各局面2回のウォームアップ後7回、候補と基準の順序を交互にして計測しました。バックエンドごとに独立したWorkerを使い、初期化・描画を除く実際の着手呼び出し（履歴復元・探索・推論・待機を含む）を測ります。CPUはAMD Ryzen 7 3700X 8-Core Processor、ブラウザーはEdge 156.0.4314.42、GPUはNVIDIA Blackwellです。

全体P95はCPU/WASMが161.5→157.7ms、WebGPUが39.2→38.6ms。各盤も1.10倍以内で、両バックエンドとも事前基準を通過しました。126回ずつの計測における推論バッチ数の平均は候補9.00、基準9.11、最大は候補9・基準10でした。[全速度計測](data/speed.json)に各局面・各盤・各試行の値があります。Pixel 8aの再実測ではありません。

Rustの12テスト、全6盤の有限64訪問・最終候補方策・合法手・確率正規化、確定勝敗、初回Worker、キャンセル、途中の予算追加、スーパーコウ、捨て石・終盤33局面、v2・生成JS・UI・速度計測ページの回帰を通過しました。[反映後の検証](data/installed-verification.json)と[実ブラウザー検証](data/installed-browser-verification.json)を保存しています。NNのPyTorch/CPU/WebGPUの最大出力差は約0.00000191でした。

## 採用と限界

[採用記録](data/adoption.json)のとおり、評価時とバイト単位で同じWASMをdist/ai-v3.wasmへ配置し、キャッシュキーを更新しました。ソースは改行だけをLFへ統一し、正規化後に評価時ソースと完全一致することを検証しています。通常のAI選択と標準64訪問は維持しました。

この結果は固定した6盤・開始配置分布・64訪問の範囲です。同じ時間の対戦、最新v2との直接対戦、スマートフォン実機、他の訪問数での棋力を測ったものではありません。実時間の根拠は同一局面の別計測で、対戦中の時間から速度の優劣を推定していません。ビルド・開発・独立評価を通した壁時計での総所要時間は記録していません。

探索係数の変更、予約値平均、勝敗ヘッドの追加学習も試しましたが、それぞれ独立評価の基準に届かず不採用にしました。[探索内の確定勝敗](../2026-10-25-search-proof/README.md)、[予約値の比較](../2026-10-25-batch-search/README.md)、[勝敗評価の追加学習](../2026-10-25-value-calibration/README.md)に失敗候補を含めて保存しています。これらは異なるseedの試験であり、候補同士の直接対戦として比較しません。

## 保存と再現

基準commitは77dd92ab74f9af8139f380835ceec4f881c1b166。[コード差分](data/source.patch)と[差分の照合](data/source-patch-verification.json)、[候補と基準のWASM・ソース](data/search/)、[固定モデル](data/model/)、[実行時のJS](data/runtime/)、[ハッシュ目録](manifest.json)を保存しています。再ビルド時の関数配置やファイルパスによるバイト差があり得るため、完全に同じ探索バイナリーで追試する場合は保存したWASMを使います。

```powershell
node tools/ai-gnn/browser-match.mjs --a experiments/ai/v3/2026-10-25-root-halving/data/model --b experiments/ai/v3/2026-10-25-root-halving/data/model --a-wasm experiments/ai/v3/2026-10-25-root-halving/data/search/selected.wasm --b-wasm experiments/ai/v3/2026-10-25-root-halving/data/search/baseline.wasm --pairs 16 --simulations 64 --seed 2026102581 --output tools/ai-gnn/target/root-halving-recheck.json
node tools/ai-gnn/bench-search.mjs --a-model experiments/ai/v3/2026-10-25-root-halving/data/model --b-model experiments/ai/v3/2026-10-25-root-halving/data/model --a-wasm experiments/ai/v3/2026-10-25-root-halving/data/search/selected.wasm --b-wasm experiments/ai/v3/2026-10-25-root-halving/data/search/baseline.wasm --output tools/ai-gnn/target/root-halving-speed-recheck.json
node v3-tests.mjs
node tools/ai-tuner/check-experiments.mjs
```

再実行は新しいtarget出力先を使い、保存済みのdata/へ上書きしません。
