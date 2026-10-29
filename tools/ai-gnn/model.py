"""v3: permutation-equivariant, 64-channel / six-block residual graph network."""
import copy
import torch
from torch import nn

POINTS, CHANNELS, GLOBALS, HIDDEN, BLOCKS = 160, 32, 8, 64, 6


def pool(h, mask):
    return (h * mask).sum(1) / mask.sum(1).clamp_min(1)


class Block(nn.Module):
    def __init__(self):
        super().__init__()
        self.local = nn.Linear(HIDDEN, HIDDEN)
        self.near = nn.Linear(HIDDEN, HIDDEN, bias=False)
        self.context = nn.Linear(HIDDEN + GLOBALS, HIDDEN)
        self.out = nn.Linear(HIDDEN, HIDDEN)

    def forward(self, h, adjacency, mask, global_features):
        g = torch.cat((pool(h, mask), global_features), -1)
        z = torch.relu(self.local(h) + self.near(adjacency @ h) + self.context(g).unsqueeze(1))
        return (h + 0.25 * self.out(z)) * mask


def head(inputs, outputs, width=32):
    return nn.Sequential(nn.Linear(inputs, width), nn.ReLU(), nn.Linear(width, outputs))


class GraphNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.input = nn.Linear(CHANNELS, HIDDEN)
        self.blocks = nn.ModuleList(Block() for _ in range(BLOCKS))
        self.policy = head(HIDDEN, 1)
        self.passing = head(HIDDEN + GLOBALS, 1)
        self.value = head(HIDDEN + GLOBALS, 3, 64)
        self.score = head(HIDDEN + GLOBALS, 1, 64)
        self.ownership = head(HIDDEN, 3)

    def features(self, x, adjacency, mask, global_features):
        h = torch.relu(self.input(x)) * mask
        for block in self.blocks:
            h = block(h, adjacency, mask, global_features)
        g = torch.cat((pool(h, mask), global_features), -1)
        return h, g

    def predictions(self, h, g):
        policy = torch.cat((self.policy(h).squeeze(-1), self.passing(g)), -1)
        return policy, self.value(g), self.score(g).squeeze(-1), self.ownership(h)

    def forward(self, x, adjacency, mask, global_features):
        return self.predictions(*self.features(x, adjacency, mask, global_features))

    def enable_soft_policy(self):
        if hasattr(self, 'auxiliary_policy'):
            raise ValueError('Auxiliary policy already enabled')
        # Copy the resumed heads without consuming the paired training RNG.
        self.auxiliary_policy = copy.deepcopy(self.policy)
        self.auxiliary_passing = copy.deepcopy(self.passing)

    def forward_with_aux(self, x, adjacency, mask, global_features):
        h, g = self.features(x, adjacency, mask, global_features)
        auxiliary = torch.cat((self.auxiliary_policy(h).squeeze(-1), self.auxiliary_passing(g)), -1)
        return self.predictions(h, g), auxiliary

    def inference_model(self):
        # Export only the original inference graph and original parameter order.
        with torch.random.fork_rng(devices=[]):
            result = GraphNet()
        result.load_state_dict({k:v for k,v in self.state_dict().items() if not k.startswith('auxiliary_')})
        return result.eval()
