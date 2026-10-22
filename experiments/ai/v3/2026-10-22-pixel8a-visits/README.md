# Pixel 8aでの共通訪問数の調整

PC・スマートフォン共通のブラウザー版v3を64訪問に設定する。ユーザーが手元のPixel 8aで測ったChrome / WebGPUとFirefox / WASMは、64訪問で全6盤のP95が300ms以内だった。300msの目標自体が400msまでの余裕を含むため、追加の20%は差し引かない。

| 訪問数 | Chrome / WebGPUの最も遅い盤のP95 | Firefox / WASMの最も遅い盤のP95 |
| --- | ---: | ---: |
| 8 | 56.0ms | 51ms |
| 16 | 109.2ms | 81ms |
| 32 | 175.8ms | 135ms |
| 64 | 269.8ms | 245ms |

## 条件と所要時間

2026-10-22に、専用HTTPS計測ページをユーザーの実機で実行した。Chromeの終了時刻は日本時間22:44:17、Firefoxは22:40:38。モデルは `8e5b41e3974cbd30349fa483bb8a3a0f5c055ea9bb6cddef82c63b69b88b4b9a`、FPUは親の実訪問平均、NNバッチは8。端末名はユーザーの申告に基づく。User-Agentの文字列からChrome側の実際のAndroidバージョンは推定しない。

[既存の対戦](../2026-10-22-vs-v2/README.md)の各盤の最初の棋譜から、序盤・中盤・終盤の18局面を固定し、ウォームアップ後に各訪問数を2周、36回計測した。Worker内の `chooseMove` 呼び出し前後の時間には局面の復元・根の処理・推論・探索・キャンセル用の待ちを含む。初期化は別計測で、Chrome 1678.5ms、Firefox 3600ms。全計測はそれぞれ約20.05秒と19.99秒だった。

## 元の判定の訂正

元ページは300msにさらに20%の余裕を差し引き、240msをしきい値にしていた。そのため両レポートの `margin: 0.8` と `recommendedVisits: 32` は当時の出力として保持する。ユーザーの指摘に従い300msで再集計した採用値は64。測定時の値を書き換えず、[summary.json](data/summary.json)に訂正後の方針と選択を分けて記録する。

## 保存と再集計

ユーザーがチャットに貼った[Chrome](data/chrome-webgpu.json)と[Firefox](data/firefox-wasm.json)のJSONの全フィールドを保存した。各手の生サンプルは共有用JSONに含まれていないため、保存されているのは盤別P95と標本数まで。盤ごとに6標本なので、nearest-rank P95はその6標本の最大値となる。公開版の識別情報は[deployment.json](data/deployment.json)、全公開資産のハッシュは[deployed-assets.json](data/deployed-assets.json)、測定時のコードは `data/source/` と [source.patch](data/source.patch)、保存物のハッシュ一覧は[manifest.json](manifest.json)にある。コードの基準は `495eefd7053241764892ad1cea95a9258b66198e`。

```powershell
node experiments/ai/v3/2026-10-22-pixel8a-visits/data/derive.mjs --check
node experiments/ai/v3/2026-10-22-pixel8a-visits/data/derive.mjs --output tools/ai-gnn/target/pixel8a-recomputed.json
node tools/ai-tuner/check-experiments.mjs
```

## 採用範囲と限界

64訪問への変更後、PCの実ブラウザーでCPU / WebGPUとも全6盤が64訪問になり、実際の対局Workerも初手からv3・64訪問になることを確認した。遅い仮想推論でも訪問数が変わらない検証、奇数の訪問数制限、終盤・キャンセル、計測ページの操作も通過している。[実装検証と専用計測ページの訂正公開](data/implementation-validation.json)に環境・観測値・公開版を記録した。対局サイト本体へのデプロイは行っていない。

全盤・全端末で同じ64訪問を使い、通常のブラウザー対局では端末別の時間打ち切りや自動調整は行わない。これは待ち時間の調整であり、64訪問での棋力評価はこの実験では行っていない。以前の300ms対戦の勝率を64訪問の勝率として扱わない。

その後の[独立した64訪問の対v2評価](../2026-10-22-fixed64-strength/README.md)では、実ブラウザーで76勝20敗、79.2%だった。棋力評価の事前計画・全棋譜・入力のハッシュはその実験に保存している。

各ブラウザー1回の測定であり、発熱・省電力・他アプリの状態は記録されていない。初回初期化は300msに含まれず、他端末や全局面の所要時間も保証しない。元ページが240msで打ち切ったため、96訪問以上は未測定であり、64は測定済みの候補の中での採用値。今回の結果の共有は完了し、追加の計測や送信用サーバーは不要になった。
