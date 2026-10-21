import unittest
import tempfile
import hashlib
from pathlib import Path
import torch
from model import GraphNet, POINTS, CHANNELS
from export_webgpu import export_webgpu


class ModelTests(unittest.TestCase):
    def test_gpu_weight_layout_preserves_every_fp32_parameter(self):
        model = GraphNet().eval()
        manifest = dict(sha256='a'*64)
        with tempfile.TemporaryDirectory() as directory:
            export_webgpu(model, Path(directory), manifest)
            data = (Path(directory) / 'weights.f32').read_bytes()
        self.assertEqual(len(data), 120905*4)
        self.assertEqual(manifest['webgpu']['sourceSha256'], manifest['sha256'])
        self.assertEqual(manifest['webgpu']['sha256'], hashlib.sha256(data).hexdigest())
        values = torch.frombuffer(bytearray(data), dtype=torch.float32)
        offset = 0
        for tensor in model.state_dict().values():
            expected = tensor.T if tensor.ndim == 2 else tensor
            torch.testing.assert_close(values[offset:offset+tensor.numel()], expected.contiguous().flatten(), atol=0, rtol=0)
            offset += tensor.numel()
        self.assertEqual(offset, len(values))

    def test_padding_and_permutation_equivariance(self):
        torch.manual_seed(7)
        torch.set_num_threads(2)
        model = GraphNet().eval()
        self.assertEqual(sum(p.numel() for p in model.parameters()), 120905)
        x = torch.randn(2, POINTS, CHANNELS)
        mask = torch.zeros(2, POINTS, 1)
        mask[:, :49] = 1
        a = torch.zeros(1, POINTS, POINTS)
        for i in range(49):
            for j in ((i+1)%49, (i-1)%49):
                a[0, i, j] = .5
        g = torch.randn(2, 8)
        with torch.no_grad():
            expected = model(x, a, mask, g)
            dirty = x.clone()
            dirty[:, 49:] = 1e5
            for left, right in zip(expected, model(dirty, a, mask, g)):
                torch.testing.assert_close(left, right)
            permutation = torch.randperm(POINTS)
            actual = model(x[:, permutation], a[:, permutation][:, :, permutation], mask[:, permutation], g)
            torch.testing.assert_close(expected[0][:, :POINTS][:, permutation], actual[0][:, :POINTS], atol=2e-6, rtol=1e-5)
            torch.testing.assert_close(expected[0][:, POINTS], actual[0][:, POINTS], atol=2e-6, rtol=1e-5)
            torch.testing.assert_close(expected[1], actual[1], atol=2e-6, rtol=1e-5)
            torch.testing.assert_close(expected[2], actual[2], atol=2e-6, rtol=1e-5)
            torch.testing.assert_close(expected[3][:, permutation], actual[3], atol=2e-6, rtol=1e-5)


if __name__ == '__main__':
    unittest.main()
