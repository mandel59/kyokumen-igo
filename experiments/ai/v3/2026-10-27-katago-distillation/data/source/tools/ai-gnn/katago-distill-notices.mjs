import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const directory=resolve(process.argv[2]),file='docs/third-party/catalog.json',catalog=JSON.parse(readFileSync(file));
const provenance=JSON.parse(readFileSync(join(directory,'provenance.json')));
const entries=[
 {id:'katago-analysis-engine',name:'KataGo Analysis Engine',version:'1.18.1',licenseExpression:'MIT',
  usage:'平面7・9・11路の蒸留用教師データをローカルで生成。実行バイナリはアプリに同梱しません。',
  url:'https://github.com/lightvector/KataGo/tree/v1.18.1',licenseURL:provenance.licenses.engineURL,
  source:'KataGo-LICENSE.txt',notice:'dist/licenses/KataGo-v1.18.1-LICENSE.txt',copyright:'Copyright 2025 David J Wu ("lightvector") and/or other authors of the content in this repository.'},
 {id:'katago-neural-network',name:'KataGo Neural Networks',version:'kata1-b10c128-s1141046784-d204142634',licenseExpression:'LicenseRef-KataGo-Neural-Network',
  usage:'v3の平面盤の着手分布を学ぶ教師として使用。公式教師ネット自体はアプリに同梱せず、生徒パッケージにも出所とネット用許諾文を添付します。',
  url:provenance.model.url,licenseURL:provenance.licenses.networkURL,
  source:'KataGo-NN-LICENSE.txt',notice:'dist/licenses/KataGo-NN-LICENSE.txt',copyright:'Copyright 2026 David J Wu ("lightvector").'}
];
for(const e of entries){
 if(catalog.entries.some(old=>old.id===e.id))throw Error('Notice entry already exists: '+e.id);
 copyFileSync(join(directory,e.source),e.notice);
 catalog.entries.push({id:e.id,name:e.name,version:e.version,category:'tool',relationship:'dependency',licenseExpression:e.licenseExpression,
  usage:e.usage,files:['tools/ai-gnn/katago-analysis.mjs'],urls:[e.url,e.licenseURL],notices:[e.notice],distribution:'development-only',
  copyrightNotices:[e.copyright],modifications:[],provenance:{kind:'tool',evidence:['tools/ai-gnn/katago-distill-setup.mjs','tools/ai-gnn/katago-distill-notices.mjs'],ref:e.version,gitBlobSha:null}});
 catalog.noticeSnapshots.push({path:e.notice,url:e.licenseURL,gitBlobSha:null,sha256:createHash('sha256').update(readFileSync(e.notice)).digest('hex')});
}
catalog.checkedOn='2026-10-27';writeFileSync(file,JSON.stringify(catalog,null,2)+'\n');console.log('Recorded KataGo engine and neural-network notices separately.');
