"""Restore one archived native teacher into a NEW directory outside dist/."""
import gzip,hashlib,json,shutil,sys
from pathlib import Path
name,output=sys.argv[1:]
if name not in ('clone','gnn','hybrid'):raise ValueError('Unknown model')
source=Path(__file__).resolve().parent/'packages'/name
output=Path(output).resolve()
repo=Path(__file__).resolve().parents[5]
if output.is_relative_to(repo/'dist'):raise ValueError('Offline package must be outside dist/')
if output.exists() and any(output.iterdir()):raise ValueError('Output must be empty')
output.mkdir(parents=True,exist_ok=True)
with gzip.open(source/'weights.pt.gz','rb') as src,open(output/'weights.pt','wb') as dst:shutil.copyfileobj(src,dst)
manifest=json.loads((source/'teacher.json').read_text())
if hashlib.sha256((output/'weights.pt').read_bytes()).hexdigest()!=manifest['sha256']:raise ValueError('Checksum mismatch')
for name in ('teacher.json','training.json'):shutil.copyfile(source/name,output/name)
print(str(output))
