// Keep notices for the standard library linked into our WASM, not only Cargo crates.
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,mkdirSync,copyFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export function prepareRustNotices(){
 const sysroot=execFileSync('rustc',['--print','sysroot'],{encoding:'utf8'}).trim();
 const source=join(sysroot,'share/doc/rust'),destination=new URL('../dist/licenses/rust/',import.meta.url);
 if(!existsSync(join(source,'COPYRIGHT-library.html')))throw new Error('Rust notices missing; run rustup component add rust-docs');
 const files=['COPYRIGHT-library.html',...readdirSync(join(source,'licenses')).sort().map(n=>'licenses/'+n)];
 // The rust-docs component supplies the release-specific aggregate and full license texts.
 const records=files.map(path=>({path,sha256:createHash('sha256').update(readFileSync(join(source,path))).digest('hex')}));
 mkdirSync(new URL('licenses/',destination),{recursive:true});
 for(const {path}of records)copyFileSync(join(source,path),new URL(path,destination));
 writeFileSync(new URL('manifest.json',destination),JSON.stringify({
  source:'Installed rust-docs component; complete upstream standard-library notices, including components unused on wasm32.',
  version:execFileSync('rustc',['--version'],{encoding:'utf8'}).trim(),files:records},null,2)+'\n');
 console.log('Prepared Rust standard-library notices ('+records.length+' files).');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)prepareRustNotices();
