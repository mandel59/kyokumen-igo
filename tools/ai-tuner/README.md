# Kyokugo AI の開発ツール

[AI の仕様と配信状態](../../docs/ai/README.md)・[実験索引と記録規約](../../experiments/ai/README.md)を入口にしてください。このディレクトリには実行コードを置き、報告書と保存データは実験ごとのディレクトリへ分離しています。

## 方式とツールの対応

| 対象 | ソース／コマンド | 役割 |
| --- | --- | --- |
| Kyokugo AI v1 | src/ai.rs、src/main.rs、src/tune.rs / cargo run | 一手評価、係数調整、対戦、固定局面の生成 |
| Kyokugo AI v2 | src/search.rs、search-tune.rs | 4 手探索、候補の調整、対戦 |
| 共通 | src/board.rs、src/rng.rs | グラフ盤・合法手・得点・乱数 |
| 配信 | src/wasm.rs、build-wasm.mjs | v1 / v2を含むWASMと、同じWASMからのJS生成（build-js.mjs） |
| 記録管理 | experiment-paths.mjs、check-experiments.mjs | 実験の場所、再集計の出力、記録の整合確認 |

以後のコマンドはリポジトリ直下から実行します。外部Rustクレートは不要です。配信用JSの生成には固定版Binaryenを使うため、初回は `npm ci --prefix tools/ai-tuner` を実行します。対戦や集計だけならBinaryenは不要です。実行結果とビルド出力は Git 管理外の target/ へ置きます。

## Kyokugo AI v1

```powershell
cargo run --manifest-path tools/ai-tuner/Cargo.toml --release -- selftest
cargo run --manifest-path tools/ai-tuner/Cargo.toml --release -- match tuned legacy --games 500 --seed 7
cargo run --manifest-path tools/ai-tuner/Cargo.toml --release -- tune
cargo run --manifest-path tools/ai-tuner/Cargo.toml --release -- parity tools/ai-tuner/target/v1-parity.json --count 300
```

この CLI の legacy は v1-original、tuned は v1-tuned-20261020 です。評価係数は src/ai.rs の Params、比較用 JS の同じ係数は legacy-v1.mjs の AI_WEIGHTS にあります。現在の固定局面は [tests/fixtures/ai/v1-parity.json](../../tests/fixtures/ai/v1-parity.json) です。係数を変更する場合は JS と Rust、固定局面を明示的に更新して一致を確認します。

## Kyokugo AI v2

```powershell
node -e "require('node:fs').mkdirSync('tools/ai-tuner/target/v2',{recursive:true})"
rustc --edition 2021 -C opt-level=3 -C lto=fat -C codegen-units=1 -A dead_code tools/ai-tuner/search-tune.rs -o tools/ai-tuner/target/v2/search-tune.exe
.\tools\ai-tuner\target\v2\search-tune.exe match deployed greedy 20 6.5 42 tools/ai-tuner/target/v2/match.json
```

上の対戦は動作確認用の小規模例です。強さの評価には別途、十分な局数と未使用 seed を計画してください。

| CLI の別名 | アーキテクチャと係数 |
| --- | --- |
| legacy | v2-original |
| tuned | v2-tuned-20261021 を全盤へ適用した候補 |
| deployed | v2-deployed-20261021（盤別の採用構成） |
| greedy | v1-tuned-20261020 |
| 係数ファイルのパス | v2 の 13 係数を空白区切りで指定 |

再現用の係数探索例は次のとおりです。新しい実験を行うときは seed と出力先を新たに決めます。

```powershell
.\tools\ai-tuner\target\v2\search-tune.exe robust tools/ai-tuner/target/v2/reproduction 6 8 20261040
```

robust は一手評価の v1 も相手に含め、候補順位を固定して静的評価の 5 係数を調整します。tune は初期の 13 係数の探索方式です。比較相手への過適合を含む結果は [v2 調整実験](../../experiments/ai/v2/2026-10-21-tuning/README.md) に記録しています。SEARCH_THREADS 環境変数で並列数を指定できます。

search-study.rs は v2-original を固定して深さを比較する履歴実験用ランナーです。現行の配信構成の評価には search-tune の deployed を使います。

## 再集計と採用判定

```powershell
node tools/ai-tuner/search-summary.mjs
node tools/ai-tuner/search-tuning-summary.mjs
node tools/ai-tuner/apply-search-tuning.mjs
```

最初の 2 つは、それぞれ v2 導入実験と係数調整実験の保存データを再集計します。3 つ目は事前規則に基づく採用判定を再計算します。既定の出力先は target/reports/ で、保存済み summary.json / adoption.json とソースは変更しません。

同じデータ形式の別実験を使う場合は、--experiment に catalog の ID または実験ディレクトリを指定し、--output で新しい出力先を指定できます。これらは既存の実験形式に対応する集計器です。新しい実験方法・採用規則を導入するときは、解析コードも対応させて版を記録してください。

```powershell
node tools/ai-tuner/search-tuning-summary.mjs --experiment v2/2026-10-21-tuning --output tools/ai-tuner/target/reports/reanalysis.json
node tools/ai-tuner/apply-search-tuning.mjs --experiment v2/2026-10-21-tuning --output tools/ai-tuner/target/reports/adoption.json --apply
```

--apply は明示的な配信係数の更新です。v2 の候補係数と盤別選択をソースへ反映します。実験データを変更せず、WASM の再生成やコミットも自動では行いません。適用した場合は次の確認を行います。

```powershell
node tools/ai-tuner/build-wasm.mjs
node tools/ai-tuner/build-wasm.mjs --check
node search-tests.mjs
node wasm-tests.mjs
node generated-js-tests.mjs
```

新しい係数の配信時は、回帰テストが参照する実験も採用結果に合わせて更新します。

## 性能・コミの評価

- bench-wasm.rs / bench-wasm.mjs：同じ v1 の JS / WASM 比較。[記録](../../experiments/ai/v1/2026-10-21-wasm-benchmark/README.md)
- komi-study.rs / komi-study.mjs：v1 自己対局のコミ集計。[記録](../../experiments/ai/v1/2026-10-21-komi/README.md)
- bench-search.mjs：現在の配信 v2 の時間測定。--wasm で比較するバイナリ、--output で出力先を指定可能

各 native ランナーのビルド条件と対局条件は個々の実験 README にあります。性能測定と再集計は別に扱い、過去のハッシュを現行ソースのハッシュへ書き換えません。

## 記録の確認

```powershell
node tools/ai-tuner/check-experiments.mjs
```

--artifacts に実験ディレクトリを指定すると、manifest へ記載するデータ一覧と SHA-256 を標準出力へ出します。既存ファイルは変更しません。

catalog と manifest の対応、全データの SHA-256、ファイルの列挙漏れ、文書のローカルリンクを確認します。実験の追加方法は [規約とテンプレート](../../experiments/ai/README.md) を参照してください。
