"""FP32 sidecar for the fixed v3 WGSL kernels; no quantization or retraining."""
import argparse
import hashlib
import json
from pathlib import Path
import torch
from model import GraphNet


def export_webgpu(model, directory, manifest):
    # Format v1 follows GraphNet.state_dict registration order. Linear matrices
    # are transposed to [input, output] for coalesced channel reads on the GPU.
    chunks = []
    for tensor in model.state_dict().values():
        value = tensor.detach().cpu()
        if value.ndim == 2:
            value = value.T
        chunks.append(value.contiguous().numpy().astype('<f4').tobytes())
    data = b''.join(chunks)
    if len(data) != 120905 * 4:
        raise ValueError('Incompatible v3 WGSL architecture')
    (directory / 'weights.f32').write_bytes(data)
    manifest['webgpu'] = dict(formatVersion=1, model='weights.f32',
        sha256=hashlib.sha256(data).hexdigest(), sourceSha256=manifest['sha256'])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--weights', required=True)
    parser.add_argument('--directory', required=True)
    parser.add_argument('--golden', required=True, help='Verify checkpoint against the existing model before installing')
    args = parser.parse_args()
    directory = Path(args.directory)
    manifest = json.loads((directory / 'manifest.json').read_text(encoding='utf-8'))
    if hashlib.sha256((directory / 'model.onnx').read_bytes()).hexdigest() != manifest['sha256']:
        raise ValueError('ONNX checksum mismatch')
    torch.set_num_threads(4)
    model = GraphNet().eval()
    model.load_state_dict(torch.load(args.weights, map_location='cpu', weights_only=True))
    golden = json.loads(Path(args.golden).read_text(encoding='utf-8'))
    if golden.get('modelSha256') != manifest['sha256']:
        raise ValueError('Golden model mismatch')
    names = ['x', 'adjacency', 'mask', 'global_features']
    inputs = [torch.tensor(golden['inputs'][k]['data']).reshape(golden['inputs'][k]['shape']) for k in names]
    with torch.no_grad():
        outputs = model(*inputs)
    for actual, target in zip(outputs, golden['outputs'].values()):
        torch.testing.assert_close(actual, torch.tensor(target['data']).reshape(target['shape']), atol=2e-5, rtol=1e-5)
    export_webgpu(model, directory, manifest)
    (directory / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(json.dumps(dict(parameters=120905, bytes=(directory / 'weights.f32').stat().st_size, webgpu=manifest['webgpu'])))


if __name__ == '__main__':
    main()
