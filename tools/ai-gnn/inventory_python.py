"""uv run --project tools/ai-gnn --extra cuda python tools/ai-gnn/inventory_python.py"""
from importlib.metadata import distributions
from pathlib import Path
import hashlib
import json
import sys

root = Path(__file__).resolve().parents[2]
packages = []
for distribution in sorted(distributions(), key=lambda d: d.metadata['Name'].lower()):
    metadata = distribution.metadata
    packages.append(dict(name=metadata['Name'], version=distribution.version,
        license=metadata.get('License-Expression') or metadata.get('License'),
        projectUrls=metadata.get_all('Project-URL', []), home=metadata.get('Home-page'),
        licenseClassifiers=[c for c in metadata.get_all('Classifier', []) if c.startswith('License')]))
lock = root / 'tools/ai-gnn/uv.lock'
inventory = dict(schemaVersion=1, source='tools/ai-gnn/uv.lock',
    sourceSha256=hashlib.sha256(lock.read_bytes()).hexdigest(), python=sys.version,
    condition='Installed uv environment; training/export tools only, not distributed in dist. '
        'License declarations are preserved from package metadata, including composite wheel licenses.',
    packages=packages)
(root / 'docs/third-party/python-packages.json').write_text(
    json.dumps(inventory, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
print(f'Inventoried {len(packages)} Python packages.')
