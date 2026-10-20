# 実験報告のテンプレート

このファイルの本文を、新しい実験ディレクトリの README.md へコピーして使います。登録手順は [実験規約](README.md) を参照してください。

```text
v2/YYYY-MM-DD-purpose/
  README.md
  manifest.json
  data/
    plan.json
    results.json
    summary.json
    progress.txt
```

## 結論

何を比較し、どの条件で改善・悪化・判断保留となったか。候補を全盤に使った成績と、実際に採用する構成を区別する。

## 識別情報

- 実験 ID：
- アーキテクチャと係数セット ID：
- 比較相手のアーキテクチャと係数セット ID：
- 実行方式：
- ソース commit、未コミット差分、主要ファイルのハッシュ：
- 実行環境と日付：

## 実行前の計画

調整・選定・独立評価それぞれの seed、局数、盤、コミ、先後と乱数の交換方法、手数上限、採用基準、終了条件を書く。

## 方法と結果

探索空間・固定値・最適化手法を明記する。全条件の成績、引き分け・打ち切り、区間推定、失敗候補、変更した計画も残す。

## 所要時間・速度

係数探索、選定、独立検証の所要時間を分ける。速度測定は初期化・履歴復元・通信・描画の含有範囲、ウォームアップ、標本数を明記する。

## 採用と限界

どの盤・条件へ採用したか、未確認の条件、方針依存の偏り、追加検証が必要な点を書く。

## 再現手順と保存データ

リポジトリ直下からのコマンドと出力先を書く。コードの固定方法、比較相手、係数ファイル、raw データと集計結果への参照を含める。

## manifest の例

```json
{
  "schemaVersion": 1,
  "id": "v2/YYYY-MM-DD-purpose",
  "architecture": "v2",
  "title": "Kyokugo AI v2 の実験名",
  "source": {"baseCommit": "<実行コードのcommit>", "patch": null},
  "variants": ["v2-original", "<candidate-id>", "v1-tuned-20261020"],
  "notes": ["ソースの版と採用判断を README に記載"],
  "artifacts": [
    {"path": "data/plan.json", "sha256": "<64桁のSHA-256>"}
  ]
}
```

artifacts は data/ 内の全ファイルを列挙します。`check-experiments.mjs --artifacts <実験ディレクトリ>` で実ファイルの一覧と SHA-256 を出力できます。legacyPath は過去の配置から移した記録だけに付ける任意項目です。新しい manifest を catalog.json に登録してください。

未コミットのコードで実行した場合は差分を data/source.patch などへ保存し、source.patch にその相対パスを指定します。recordedAtCommit は既存記録を移した場合の任意の履歴参照で、新しい実験の実行コードは source.baseCommit で特定します。
