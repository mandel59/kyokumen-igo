// Install only the experimental slot; this never promotes a model to production.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {validateManifest} from '../../dist/ai-v3-inference.js';
const source=resolve(process.argv[2]??'tools/ai-gnn/target/model');
const manifest=JSON.parse(readFileSync(join(source,'manifest.json'),'utf8'));validateManifest(manifest);
const bytes=readFileSync(join(source,manifest.model));
if(createHash('sha256').update(bytes).digest('hex')!==manifest.sha256)throw new Error('Invalid model checksum');
const destination=new URL('../../dist/models/v3/',import.meta.url);mkdirSync(destination,{recursive:true});
writeFileSync(new URL('model.onnx',destination),bytes);
writeFileSync(new URL('manifest.json',destination),JSON.stringify(manifest,null,2)+'\n');
const golden=JSON.parse(readFileSync(join(source,'golden.json'),'utf8'));golden.modelSha256=manifest.sha256;
writeFileSync(new URL('../../tests/fixtures/ai/v3-golden.json',import.meta.url),JSON.stringify(golden)+'\n');
console.log('Installed experimental v3 model: '+manifest.parameters+' parameters, '+bytes.length+' bytes.');
