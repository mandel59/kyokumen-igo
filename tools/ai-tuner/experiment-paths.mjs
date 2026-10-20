// Shared locations for archived inputs and disposable reanalysis outputs.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
export const toolRoot=new URL('./',import.meta.url);
export const archiveRoot=new URL('../../experiments/ai/',import.meta.url);
const catalog=JSON.parse(fs.readFileSync(new URL('catalog.json',archiveRoot),'utf8'));
export function option(name){
 const i=process.argv.indexOf(name);if(i<0)return undefined;
 const value=process.argv[i+1];if(!value||value.startsWith('--'))throw Error(name+' requires a value');return value;
}
export function experimentDir(id){
 const entry=catalog.experiments.find(e=>e.id===id);
 if(!entry)throw Error('Unknown experiment ID: '+id);
 return new URL(entry.path,archiveRoot);
}
export function outputPath(relative){return option('--output')?pathToFileURL(path.resolve(option('--output'))):new URL(relative,toolRoot);}
export function reportOptions(id,name='summary.json'){
 const selector=option('--experiment');
 const dir=!selector?experimentDir(id):catalog.experiments.some(e=>e.id===selector)?experimentDir(selector):pathToFileURL(path.resolve(selector)+path.sep);
 return {dir,data:new URL('data/',dir),output:outputPath('target/reports/'+id+'/'+name),
  context:{inputExperiment:dir.href,analyzedAt:new Date().toISOString(),note:'Reanalysis with current tools; original archived artifacts are not overwritten by default.'}};
}
export function writeReport(output,report){
 fs.mkdirSync(path.dirname(fileURLToPath(output)),{recursive:true});
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
}
