// Writes dist/revision.txt for the About dialog. Run it before deploying; "+" marks uncommitted changes.
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';

const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const revision=git('rev-parse','--short=8','HEAD')+(git('status','--porcelain','--untracked-files=no')?'+':'');
writeFileSync(new URL('../dist/revision.txt',import.meta.url),revision+'\n');
console.log('dist/revision.txt: '+revision);
