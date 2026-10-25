# Kyokugo AI

曲面囲碁の AI の仕様・配信状態・実験記録の入口です。

## アーキテクチャ名

| 名前 | 着手選択 | 実装 |
| --- | --- | --- |
| [Kyokugo AI v1](architectures/v1.md) | 合法手を採点する一手評価。相手の応手は探索しない | JS / Rust / WASM |
| [Kyokugo AI v2](architectures/v2.md) | 候補手を限定した最大 4 手の alpha-beta 探索 | Rust / WASM / 自動生成JS |
| [Kyokugo AI v3（実験）](architectures/v3.md) | 小型GNN・根の逐次半減・内部のバッチPUCT | Rust / WASM + WebGPU / ONNX |

v1 / v2 / v3 はアーキテクチャの世代です。係数の再調整、モデルの再学習、盤別の採用、実行方式の違いでは世代を変えません。WASM の ABI バージョンも別の番号です。

v2 の深さ 1〜3 手の試走は、v2 の探索量を減らした比較条件です。評価関数も異なるため、深さ 1 の試走を v1 と読み替えません。

## 現在の配信状態

通常はKyokugo AI v2をWorker内のWASMで実行します。WASMを利用できない場合は同じRustから生成したJS版v2へ切り替え、Workerを利用できない場合も同じ生成JSを画面側で実行します。手書きJS版v1は比較・検証用であり、アプリからは呼びません。

v3は `?ai=v3` で試す実験実装です。[4,096訪問教師から蒸留した小型モデル](../../experiments/ai/v3/2026-10-25-teacher-distillation-pilot/README.md)と、根の逐次半減探索を使います。同じ64訪問で更新前v3に138勝54敗（独立192局）となり、全6盤の勝率とCPU/WASM・WebGPUの速度基準を通過しました。[セットアップと学習手順](../../tools/ai-gnn/README.md)を参照してください。

| 盤 | アーキテクチャ | v2 の係数 |
| --- | --- | --- |
| 球面・小／標準／大 | Kyokugo AI v2 | `v2-original` |
| トーラス 7×7／9×9 | Kyokugo AI v2 | `v2-tuned-20261021` |
| トーラス 11×11 | Kyokugo AI v2 | `v2-original` |

配信構成を `v2-deployed-20261021` と呼びます。係数の候補を全盤へ適用した評価結果と、盤別に採用した配信構成の成績は区別します。根拠は [v2 の調整実験](../../experiments/ai/v2/2026-10-21-tuning/README.md) にあります。

## 読み進め方

- 方式・評価関数・係数セット：[v1 仕様](architectures/v1.md)、[v2 仕様](architectures/v2.md)
- 配信、フォールバック、ビルド：[WASM と Worker](wasm.md)
- 過去の結果と今後の記録規約：[実験索引](../../experiments/ai/README.md)
- 実行コマンド：[ツールの使い方](../../tools/ai-tuner/README.md)

## 配置

```text
docs/ai/                  現行仕様と運用手順
experiments/ai/            実験索引・記録規約・テンプレート
  v1/<日付-目的>/         実験ごとの README・manifest・data/
  v2/<日付-目的>/
tools/ai-tuner/            実行・集計・ビルド・記録検証ツール
tests/fixtures/ai/         回帰テストで使う固定局面
```

実験報告は各実験の README に置き、仕様書から参照します。過去の測定値を現行仕様に混ぜず、同じ日に複数の実験を追加できる形にしています。

[逐次半減探索の蒸留・重点学習の比較](../../experiments/ai/v3/2026-10-25-search-distillation/README.md)では、新しい教師生成と2候補の再学習を評価しました。独立した採用条件を満たさず、配信モデルは維持しています。

[現行探索による自己対局からの蒸留](../../experiments/ai/v3/2026-10-25-onpolicy-distillation/README.md)では、新しい探索で生成した自己対局から再学習を評価しました。独立した採用条件を満たさず、配信モデルは維持しています。

[根の探索評価値の重みの比較](../../experiments/ai/v3/2026-10-25-root-value-scale/README.md)では、同じ64訪問で採用条件を満たした探索へ更新しました。

[4,096訪問教師からの蒸留](../../experiments/ai/v3/2026-10-25-teacher-distillation-pilot/README.md)では、採用条件を通過した同容量の生徒モデルをv3へ採用しました。ブラウザーの探索は64訪問です。
