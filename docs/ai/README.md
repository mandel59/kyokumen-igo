# Kyokugo AI

曲面囲碁の AI の仕様・配信状態・実験記録の入口です。

## アーキテクチャ名

| 名前 | 着手選択 | 実装 |
| --- | --- | --- |
| [Kyokugo AI v1](architectures/v1.md) | 合法手を採点する一手評価。相手の応手は探索しない | JS / Rust / WASM |
| [Kyokugo AI v2](architectures/v2.md) | 候補手を限定した最大 4 手の alpha-beta 探索 | Rust / WASM |

v1 / v2 はアーキテクチャの世代です。係数の再調整、盤別の採用、JS と WASM の実行方式の違いでは世代を変えません。WASM の ABI バージョンも別の番号です。

v2 の深さ 1〜3 手の試走は、v2 の探索量を減らした比較条件です。評価関数も異なるため、深さ 1 の試走を v1 と読み替えません。

## 現在の配信状態

通常は Kyokugo AI v2 を Worker 内の WASM で実行します。WASM / Worker を利用できない場合は Kyokugo AI v1 の JS 実装で継続します。

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
