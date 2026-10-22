// Writes dist/build-info.json for the About dialog. Run it before deploying; "+" marks uncommitted changes.
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';

const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const revision=git('rev-parse','--short=8','HEAD')+(git('status','--porcelain','--untracked-files=no')?'+':'');
const now=new Date(),pad=n=>String(n).padStart(2,'0');
const deployed=`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
writeFileSync(new URL('../dist/build-info.json',import.meta.url),JSON.stringify({revision,deployed})+'\n');
console.log(`dist/build-info.json: ${revision} ${deployed}`);
