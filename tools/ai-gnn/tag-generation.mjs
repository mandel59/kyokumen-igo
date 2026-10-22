import {createReadStream,createWriteStream} from 'node:fs';
import {createGunzip,createGzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {resolve} from 'node:path';
const args=process.argv.slice(2),arg=k=>args[args.indexOf(k)+1];
const input=arg('--input'),output=arg('--output'),generation=Number(arg('--generation'));
if(!input||!output||resolve(input)===resolve(output)||!Number.isInteger(generation)||generation<1)throw new Error('Expected distinct --input/--output and --generation');
const file=createWriteStream(output),gzip=createGzip();gzip.pipe(file);let positions=0;
for await(const line of createInterface({input:createReadStream(input).pipe(createGunzip()),crlfDelay:Infinity})){
 const r=JSON.parse(line);if(r.source!=='selfplay'||r.replayGeneration!==undefined&&r.replayGeneration!==generation)throw new Error('Invalid replay generation');
 if(!gzip.write(JSON.stringify({...r,replayGeneration:generation})+'\n'))await once(gzip,'drain');positions++;
}
gzip.end();await once(file,'finish');console.log(JSON.stringify({input,output,generation,positions}));
