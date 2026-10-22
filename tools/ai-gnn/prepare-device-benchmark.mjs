// Prepare a separate static calibration page; never publish the working application's unrelated changes.
import {readFileSync,writeFileSync,mkdirSync,cpSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {benchmarkAssets} from './device-benchmark-server.mjs';
const target=resolve('tools/ai-gnn/target/pixel8a-calibration'),assets=resolve(target,'assets');
mkdirSync(assets,{recursive:true});
for(const path of benchmarkAssets){const destination=resolve(assets,path);mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,readFileSync(resolve('dist',path)));}
cpSync('dist/vendor/onnxruntime',resolve(assets,'vendor/onnxruntime'),{recursive:true});
cpSync('dist/licenses',resolve(assets,'licenses'),{recursive:true});
writeFileSync(resolve(assets,'index.html'),readFileSync('dist/ai-benchmark.html'));
const production=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
const config={name:'kyokugo-pixel8a-20261022',account_id:production.account_id,compatibility_date:production.compatibility_date,
 workers_dev:true,preview_urls:true,assets:{directory:'./assets'}};
writeFileSync(resolve(target,'wrangler.json'),JSON.stringify(config,null,2)+'\n');
console.log('Prepared calibration-only assets and separate Worker config: '+target);
