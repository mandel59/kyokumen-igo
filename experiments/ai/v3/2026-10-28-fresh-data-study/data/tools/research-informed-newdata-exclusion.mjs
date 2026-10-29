import {readFileSync,writeFileSync,createReadStream} from 'node:fs';
import {createGunzip} from 'node:zlib';import {createInterface} from 'node:readline';import {createHash} from 'node:crypto';
import {decodeRecord} from '../../dist/record.js';import {aiPosition} from '../../dist/ai-position.js';import {createV3Search} from '../../dist/ai-v3-search.js';
const dir='tools/ai-gnn/target/fresh-data-study-20261028',plan=JSON.parse(readFileSync(dir+'/plan.json')),pin=JSON.parse(readFileSync(dir+'/split.json')),fixture=JSON.parse(readFileSync('tools/ai-gnn/target/research-informed-study-20261028/reported-game.json'));
const {game}=decodeRecord(fixture.recordCode);game.undo(game.moves-39);
const search=await createV3Search({load:async()=>readFileSync(dir+'/search.wasm')});search.start(aiPosition(game),{fpu:1});const root=search.collect(1,1);
const expected={x:Array.from(root.x.subarray(0,121*32)),global:Array.from(root.global_features),legal:Array.from(root.legal,Boolean)};search.dispose();
let scanned=0,trainingMatches=0,validationMatches=0;
for(const file of [plan.legacyData,dir+'/fresh-all.jsonl.gz']){
 const lines=createInterface({input:createReadStream(file).pipe(createGunzip()),crlfDelay:Infinity});
 for await(const line of lines){if(!line)continue;const r=JSON.parse(line);scanned++;
  if(r.kind!=='plane'||r.size!==11||r.ply!==39)continue;
  if(JSON.stringify(r.x)===JSON.stringify(expected.x)&&JSON.stringify(r.global)===JSON.stringify(expected.global)&&JSON.stringify(r.legal)===JSON.stringify(expected.legal)){
   if(pin.trainGames.includes(r.gameId))trainingMatches++;else validationMatches++;
  }
 }
}
const out={role:'Post-training explanatory data exclusion check; not used to select or tune a model.',scannedPositions:scanned,rootPly:39,trainingFeatureMatches:trainingMatches,validationFeatureMatches:validationMatches,rootSha256:createHash('sha256').update(JSON.stringify(expected)).digest('hex')};
writeFileSync(dir+'/results/reported-game-exclusion.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out));
