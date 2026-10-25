import fs from 'node:fs';import crypto from 'node:crypto';import path from 'node:path';import zlib from 'node:zlib';import {execFileSync} from 'node:child_process';
const src='tools/ai-gnn/target/teacher-budget-4096',dest='experiments/ai/v3/2026-10-25-teacher-budget-4096',hash=b=>crypto.createHash('sha256').update(b).digest('hex');
if(fs.existsSync(dest))throw Error('Archive already exists');
const p=JSON.parse(fs.readFileSync(src+'/plan.json')),decision=JSON.parse(fs.readFileSync(src+'/final-selection.json')),validation=JSON.parse(fs.readFileSync(src+'/replay-validation.json'));
if(validation.games!==192||!validation.allGamesReplayedLegally)throw Error('Study has not completed validation');
for(const[f,h]of Object.entries({...p.sourceHashes,...p.baselineFiles}))if(hash(fs.readFileSync(f))!==h)throw Error('Runtime changed '+f);
fs.mkdirSync(dest+'/data',{recursive:true});
function copy(a,b){fs.mkdirSync(path.dirname(b),{recursive:true});fs.copyFileSync(a,b);}
function tree(a,b){for(const e of fs.readdirSync(a,{withFileTypes:true}))if(e.isDirectory())tree(a+'/'+e.name,b+'/'+e.name);else copy(a+'/'+e.name,b+'/'+e.name);}
copy(src+'/plan.json',dest+'/plan.json');
for(const e of fs.readdirSync(src,{withFileTypes:true}))if(e.isFile()&&e.name!=='plan.json'){
 const file=src+'/'+e.name,out=dest+'/data/'+e.name;
 if(/^(sh8|all)-(sphere|torus|aggregate|final)/.test(e.name)&&e.name.endsWith('.json')&&!e.name.endsWith('-command.json'))fs.writeFileSync(out+'.gz',zlib.gzipSync(fs.readFileSync(file),{level:9}));
 else if(/\.(json|mjs|txt|log|wasm)$/.test(e.name))copy(file,out);
}
for(const f of [...Object.keys(p.sourceHashes),'tools/ai-gnn/teacher-budget-statistics.mjs','tools/ai-gnn/test-teacher-budget-statistics.mjs','tools/ai-gnn/pooled-inference.mjs','tools/ai-gnn/test-pooled-inference.mjs','tools/ai-gnn/validate-pooled-webgpu.mjs'])copy(f,dest+'/data/source/'+f);
tree(p.model,dest+'/data/baseline-model');
for(const mode of ['sh8','all'])tree('experiments/ai/v3/2026-10-25-teacher-search/data/'+mode+'-source',dest+'/data/'+mode+'-source');
copy('experiments/ai/v3/2026-10-25-teacher-search/data/all-build.json',dest+'/data/all-build.json');
copy('experiments/ai/v3/2026-10-25-teacher-search/data/mode-validation.json',dest+'/data/prior-mode-validation.json');
const catalogPath='experiments/ai/catalog.json',catalog=JSON.parse(fs.readFileSync(catalogPath));catalog.experiments.push({id:p.id,architecture:'v3',title:'4,096訪問の8候補・全候補探索と現行64訪問の比較',path:'v3/2026-10-25-teacher-budget-4096/'});fs.writeFileSync(catalogPath,JSON.stringify(catalog,null,2)+'\n');
fs.appendFileSync('experiments/ai/README.md','\n[4,096訪問の教師探索と現行64訪問の比較](v3/2026-10-25-teacher-budget-4096/README.md)を保存しました。\n');
fs.appendFileSync('tools/ai-gnn/README.md','\n[4,096訪問の教師探索比較](../../experiments/ai/v3/2026-10-25-teacher-budget-4096/README.md)では、8候補・全候補を現行64訪問と各96局で比較しました。`teacher-budget-statistics.mjs` は盤ごとの黒白ペアを再標本化し、通常95%区間と2候補の比較を補正した97.5%区間を返します。\n');
const rows=decision.candidates.map(c=>{const s=c.summary;return '| '+[c.variant,s.wins+'勝'+s.draws+'分'+s.losses+'敗・打切'+s.capped,(s.scoreRate*100).toFixed(1)+'%',s.pairedBootstrap?s.pairedBootstrap.interval95.map(v=>(100*v).toFixed(1)).join('–')+'%':'打切あり・算出せず',s.pairedBootstrap?s.pairedBootstrap.interval97_5.map(v=>(100*v).toFixed(1)).join('–')+'%':'打切あり・算出せず',c.eligible?'通過':'未達'].join(' | ')+' |';}).join('\n');
const boardRows=p.boards.map(b=>'| '+b.key+' | '+decision.candidates.map(c=>c.summary.boards.find(s=>s.board===b.key).score+'/16').join(' | ')+' |').join('\n');
const report=`# 4,096訪問の教師探索と現行64訪問の比較

モデルを固定し、8候補探索と全候補探索をそれぞれ現行64訪問と96局ずつ、計192局で比較しました。${decision.selected?'事前基準を通過した候補のうち'+decision.selected+'を次の教師データ検討に選びました。':'両候補とも事前基準を満たさず、この設定からの教師データ拡充・蒸留には進めません。'}配信モデルと本番探索の変更はありません。

## 事前計画と結果

[計画](plan.json)を実行前に固定しました。同じモデル8e5b41e3974c、FPU1、逐次半減の根Q係数0.4、内部PUCT1.5、コミ6.5です。教師側4,096訪問、基準側は配信と同じ8候補・64訪問にしています。全6盤各8組、各組で最初のランダム合法4手を共有し、黒白を入れ替えます。候補間も同じ盤seed・開始局面です。勝敗を見て途中で打ち切る判断はしていません。

| 教師候補 | 対現行64訪問 | 得点率 | 通常95%区間 | 補正97.5%区間 | 進出基準 |
| --- | --- | --- | --- | --- | --- |
${rows}

| 盤 | 8候補4,096訪問 | 全候補4,096訪問 |
| --- | --- | --- |
${boardRows}

選択規則は得点率60%以上、補正97.5%区間の下限50%超、全盤8/16点以上、違法手・上限打ち切りなしです。複数候補が通過すれば総得点の高い方、同点なら8候補を選びます。[最終選択](data/final-selection.json)に全条件と集計を保存しています。盤別の半数以上という条件は観測得点の基準であり、各盤で非劣性を統計的に証明するものではありません。

## 方法と検証

区間は各盤の黒白ペア8組を再標本化する20,000回の層別ペア・ブートストラップです。2候補を試す点を考慮し、選択にはBonferroni補正に対応する両側97.5%区間を使います。通常95%区間も併記しました。有限標本のpercentile法による近似で、正確検定ではありません。候補同士の直接対戦を行った結果でもありません。

96局を盤別の6ファイルへ分け、2候補で計12ジョブにしました。GPU1台で最大6プロセスを同時実行し、固定訪問数で時間上限は設けません。壁時計時間は競合・起動・測定を含み、速度比較には使えません。基準との訪問数も異なるため、同じ計算量での強さやブラウザー速度の実験ではありません。負けが確定した場合だけ既存規則で早く停止します。

根候補数は8または最大161です。全候補も既存の枝刈りを通った適格手が対象です。WASMは前回の[同予算比較](../2026-10-25-teacher-search/README.md)で検証したバイナリと同一で、4,096訪問はノード容量8,192の範囲内です。訪問数が増えると既存の根Q重みも訪問数に従って変化するため、純粋な探索深度だけの効果を切り分ける試験ではありません。

[照合記録](data/replay-validation.json)の通り、全192局をルールエンジンで再生し、合法手・終局/打切状態、終局した局の得点差・勝敗を照合しました。打切局がある候補は基準未達とし、ブートストラップ区間は算出しません。全手のWebGPUバックエンド、通常手の訪問数の完全一致、候補間と黒白ペアの開始局面一致も確認しました。来歴のソース・WASM・モデルハッシュは事前計画と一致します。

統計の端点順位は1/40と1/80を有理数として計算し、浮動小数点の丸めによる順位ずれを防ぎました。対局開始後の単体検証で見つけた分析コードの修正で、対局条件・対局処理・仮説・選択基準は変えていません。実行中のドライバーが読み込んだ版はrun-executed.mjs・statistics-executed.mjs、最終集計はaggregate.mjsとdata/sourceの修正版に対応します。[分析修正記録](data/analysis-revision.json)とstatistics-validation.logに保存しました。採用判断には*-final.json.gzとfinal-selection.jsonだけを使います。

## 後段のデータ生成に向けた準備

研究用のpooled-inference.mjsは、複数の独立した探索から届くNN推論を最大64局面へまとめます。各探索がcollect・backupするバッチは従来と同じ最大8葉です。入力をコピーして保存し、同じグラフの要求だけをまとめ、出力を元の要求へ振り分けます。個々の探索の選択順序を変える処理ではありません。

この処理は上記192局の対局には一切使っていません。CPU単体検証に加え、対局終了後に全6盤で通常推論とのビット一致、1〜8局面の混在、64局面のまとめ処理、65訪問の探索結果・診断の一致を検証しました。1,380局面の推論結果が一致し、検証結果は[pooled-webgpu-validation.json](data/pooled-webgpu-validation.json)、コードはdata/sourceに保存しました。既存の配信ファイルは変更しません。大量データの生成や蒸留を実行したという意味ではありません。

## 保存内容と次の判断

各局・各手の完全レポート、実行コマンド・時刻・終了コード・ログ、実行ソース、モデル、探索WASMとRustソースをdata/へ保存しました。sh8-final.json.gz・all-final.json.gzは盤別レポートから集計した全96局を含みます。*_command等のパスは当時の作業ディレクトリに対応します。再実行時は保存済み実験data/へ出力せず、新しい作業ディレクトリへコピーしてパスを調整します。

${decision.selected?'通過は、この凍結した現行64訪問の相手に対して強い教師探索の候補が見つかったという意味です。[teacher-profile.json](data/teacher-profile.json)に、モデル・WASM・探索設定と基準相手への成績を固定しました。次は新しい独立局面で自己対局・再解析を行い、教師の方策目標と勝敗予測を検証します。生徒への蒸留効果はまだ試していません。':'進出基準に届かない候補を強い教師として採用せず、教師データの大量生成と蒸留は保留します。探索予算とモデル容量を増やすだけで強さが保証されないため、次の研究では探索の評価値・方策目標・勝敗予測の誤りを具体的な局面から調べます。'}本ゲーム全体での最大棋力、他の相手に対する優位、蒸留後の強さは別の試験が必要です。

ブランチresearch/offline-teacher、基準コミット${p.baseCommit}。dist/と本番Rustソースは変更せず、デプロイは行っていません。
`;
fs.writeFileSync(dest+'/README.md',report);
const patch=execFileSync('git',['diff','--binary','HEAD','--','tools/ai-gnn','experiments/ai/README.md','experiments/ai/catalog.json'],{maxBuffer:20e6});fs.writeFileSync(dest+'/data/source.patch',patch);
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(d+'/'+e.name):[d+'/'+e.name]);
const artifacts=walk(dest+'/data').sort().map(f=>({path:f.slice(dest.length+1),sha256:hash(fs.readFileSync(f))}));
fs.writeFileSync(dest+'/manifest.json',JSON.stringify({schemaVersion:1,id:p.id,architecture:'v3',title:'Paired4096-visit offline teachers versus64-visit baseline',source:{baseCommit:p.baseCommit,patch:'data/source.patch',untrackedToolSnapshots:'data/source/tools/ai-gnn'},variants:p.variants,plan:{path:'plan.json',sha256:hash(fs.readFileSync(dest+'/plan.json'))},notes:['192 preplanned paired games, fixed visits with no time cutoff.','Multiplicity-adjusted97.5% percentile-bootstrap intervals for two candidates; all games replay validated.','Final analysis uses rational percentile ranks; original driver/statistics snapshots retained.','No production source/assets changed or deployment; student distillation untested.'],artifacts},null,2)+'\n');
console.log('Archived',artifacts.length,'artifacts at',dest);
