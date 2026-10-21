import unittest
import torch
from model import GraphNet, POINTS, CHANNELS


class ModelTests(unittest.TestCase):
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
