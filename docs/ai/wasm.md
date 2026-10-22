# Kyokugo AI の WASM / Worker 運用

Kyokugo AI v2 の着手計算を Rust / WASM で実行し、Web Worker 内で実行します。配信物は `dist/ai-engine.wasm`（62,360 bytes）と、同じWASMから生成した `dist/ai-engine.generated.js`（435,752 bytes、gzip 63,318 bytes）です。

## WASM に移す範囲

| 処理 | 担当 |
| --- | --- |
| AI 候補手の合法性、取り、連・呼吸点、スーパーコウの確認 | Rust / WASM |
| AI の勢力評価・採点・最大 4 手の探索・着手選択 | Rust / WASM |
| 実際に対局へ着手を適用する最終検証 | JS の `Game` |
| プレイヤーの入力、待った、終局・得点表示 | JS |
| 保存復元、棋譜リンク、設定、盤面描画 | JS |

計算量の多い AI 評価を移すことで、保存形式や操作・描画のインターフェースを変えずに高速化します。Rust は調整ツールと同じ [ai.rs](../../tools/ai-tuner/src/ai.rs)、[board.rs](../../tools/ai-tuner/src/board.rs)、[rng.rs](../../tools/ai-tuner/src/rng.rs) を使います。通常は [search.rs](../../tools/ai-tuner/src/search.rs) の最大 4 手の候補限定探索を使います。Kyokugo AI v1も比較実験・一致確認のために維持します。手書きJS版は `tools/ai-tuner/legacy-v1.mjs` に置き、アプリからは呼びません。初版は [探索 AI の評価](../../experiments/ai/v2/2026-10-21-initial/README.md)、現行係数と盤別採用は [チューニング記録](../../experiments/ai/v2/2026-10-21-tuning/README.md) を参照してください。

## データとライフサイクル

1. UI は盤種・サイズ・コミ・全着手履歴を Worker へ送ります。着手履歴は `Int32Array` で、交点番号、パスは `-1` です。各手の盤面スナップショットは送りません。転送するバッファは UI の対局状態とは別に作ります。
2. WorkerはWASMを1度読み込み、共通アダプターでABIバージョンと必要な関数・メモリーを確認します。探索係数と配信物の一致は、Rust / WASM / 生成JSのビルド照合と代表局面の選択手比較で確認します。
3. WASM は履歴を合法手として再生し、スーパーコウを含む状態を復元します。相手の生存石から敗北を証明できた根ではパスを返し、それ以外は候補を絞った最大 4 手の alpha-beta 探索で着手を選びます。乱数は JS から渡す seed を使い、ルート候補の順位に少量のゆらぎを加えます。
4. UI は回答を現在の `Game` で検証してから着手します。

Worker は手番をまたいで再利用します。WASM 内では現在の盤の隣接関係・勢力範囲・探索用配列と入力バッファを再利用し、盤種やサイズを変えると以前の盤を解放します。対局状態は各リクエストの履歴から作り直すため、待ったや保存復元との同期用に別の永続状態を持ちません。

新しい対局、待った、棋譜表示への切り替えなどの取消しでは Worker を終了し、リクエスト ID を更新して古い回答を無視します。通常の回答では終了しません。計算は次のイベントループですぐに依頼し、AI の手番全体が最低 400 ms になるよう、早く返った回答だけ残り時間を待って反映します。計算自体が 400 ms 以上かかった場合は追加で待ちません。この待機も取消しの対象です。

## フォールバック

WASM非対応・取得失敗・破損・ABI不一致・実行失敗時は、同じv2のWASMから自動生成したJSへ切り替えます。Workerの起動・応答に失敗した場合や不正な着手を返した場合も、画面側で同じ生成JS版v2を深さ4で実行します。手書きv1への切り替えはありません。不正な入力履歴はエラーとして返し、正常なWASMを故障扱いにしません。

生成JSは必要な場合だけ動的に読み込み、通常のWASM対局では取得しません。WASM版と生成JS版は [ai-api.js](../../dist/ai-api.js) のABI・入力検証・バッファ管理を共有します。生成JSはインスタンスごとにメモリーと補助関数を独立させます。読み込み中に待った・新しい対局が選ばれた場合は、古い着手を適用しません。生成JSの取得・実行も失敗した場合は、対局を変更せず画面にエラーを表示します。

JS生成はBinaryen 132.0.0のwasm2jsでビルド時に行います。ブラウザー内での変換や外部コンパイラーの取得はありません。ライセンスと出所は [第三者目録](../third-party/catalog.json) に記録し、生成物には [Apache-2.0の原文](../../dist/licenses/Binaryen-LICENSE.txt) と既存のRustランタイム告知を添えます。

WASM の初期化にはバイト列からの `WebAssembly.instantiate` を使い、静的ホストの Content-Type が `application/octet-stream` でも動作します。外部パッケージやネットワーク上の AI サービスは不要です。

## ビルドと配信

配布済みの `dist/` にはコンパイル済みWASMと生成JSを含めます。アプリを起動するだけなら Rust は不要で、従来どおり `dist/` 全体を静的配信します。

Rust の AI や盤・ルール、WASM のアダプタを変更した場合は、リポジトリ直下から再生成します。

```sh
rustup target add wasm32-unknown-unknown
npm ci --prefix tools/ai-tuner
node tools/ai-tuner/build-wasm.mjs
node wasm-tests.mjs
```

ビルドは rustc 1.99.1、`opt-level=3`、LTO、codegen-units=1、panic=abort、strip=symbols で確認しています。ビルドスクリプトはカレントディレクトリに依存しません。変更後のソースと配布バイナリの一致は、同じツールチェーンで次のように確認できます。

```sh
node tools/ai-tuner/build-wasm.mjs --check
```

このコマンドはWASMと生成JSの両方を検査します。生成物は直接編集しません。

## 検証

- `search-tests.mjs`：代表対局の 1,257 手を再生し、敗北確定時のパスと、それ以外の native / WASM の選択手一致を検証します。報告された終盤 33 局面は深さ 1–4 のすべてでパスすることも確認します。
- `wasm-tests.mjs`：配布する実際の WASM と JS で 300 局面の選択手を照合します。取り・スーパーコウ、待った後の分岐、パス・終局、乱数、入力の検証も確認します。実際の Worker ハンドラを Worker thread 上で動かし、WASM の再利用、404・破損・非対応時の生成JS版v2への切り替えを検証します。
- `generated-js-tests.mjs`：全6盤・深さ0〜4で1,248回の選択手比較、同じseed、インスタンス分離・メモリー増加、入力検証、初期化と実行時の切り替え、WebAssemblyなしでの実行を検証します。
- `tools/ai-gnn/test-generated-js-browser.mjs`：実ブラウザーで通常時の生成JS未取得、WASMの404・破損・非対応、Workerの非対応・故障、生成JSの取得失敗、読み込み中の待ったを確認します。同じ18局面・深さ4・3周でWASMと生成JSの時間も計測し、`tools/ai-gnn/target/generated-js-browser.json` に保存します。実行には `npm ci --prefix tools/ai-gnn` が必要です。
- `ui-tests.mjs`：Worker の再利用、転送した履歴、待った・新しい対局による取消し、古い回答・エラーの無視、不正な回答からの JS 切り替えを確認します。
- 既存のエンジン、保存復元、棋譜、描画、回転・投影などのテストも通しています。
- ヘッドレス Edge 155.0.4283.62 では、HTTP 配信した実アプリで WASM の使用、2 手番で Worker / WASM 取得が各 1 回であること、待った・再読み込み後の対局、スーパーコウ履歴の復元を確認しました。WASMを404にした場合の生成JS版v2の継続と、Content-Type が `application/octet-stream` の場合も確認しています。

高速化の事前測定は [WASM-BENCHMARK.md](../../experiments/ai/v1/2026-10-21-wasm-benchmark/README.md) を参照してください。そちらの約 8.3 倍はウォームアップ後の着手計算の比較で、アプリの描画・保存・Worker 起動を含めた応答時間の倍率ではありません。

生成JSの[検証記録](generated-js-verification.json)では、Ryzen 7 3700X / Edge 155の同じ18局面・深さ4・54標本で、ウォーム着手計算の平均はWASM 5.75ms、生成JS 35.11ms、P95はそれぞれ10.8msと96.1msでした。生成JSは通常のWASM対局では取得しません。この値はPC上の測定で、Pixel 8aの所要時間を表すものではありません。

[AI 文書の入口](README.md) / [実験索引](../../experiments/ai/README.md)
