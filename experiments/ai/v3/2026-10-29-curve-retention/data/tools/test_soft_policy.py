import copy
import unittest
import torch
from torch.nn import functional as F
from model import GraphNet
from train import Prepared,softened_policy_target
from test_training import item

class SoftPolicyTests(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(2)
        torch.manual_seed(17)

    def inputs(self):
        return (torch.randn(2,160,32),torch.eye(160).unsqueeze(0),torch.ones(2,160,1),torch.randn(2,8))

    def test_softening_preserves_zeros_and_masks_illegal_actions(self):
        target=torch.tensor([[.8,.05,0.,.15]])
        legal=torch.tensor([[True,True,True,False]])
        actual=softened_policy_target(target,legal,4)
        torch.testing.assert_close(actual,torch.tensor([[2/3,1/3,0.,0.]]))
        self.assertEqual(actual[0,2].item(),0.)
        self.assertEqual(actual[0,3].item(),0.)
        for temperature in (0.,-1.,float('nan')):
            with self.assertRaises(ValueError):softened_policy_target(target,legal,temperature)

    def test_auxiliary_initialization_and_removal_preserve_rng_and_outputs(self):
        model=GraphNet().eval();inputs=self.inputs()
        with torch.no_grad():expected=model(*inputs)
        rng=torch.get_rng_state().clone()
        model.enable_soft_policy()
        self.assertTrue(torch.equal(rng,torch.get_rng_state()))
        with torch.no_grad():
            normal,auxiliary=model.forward_with_aux(*inputs)
        for a,b in zip(expected,normal):self.assertTrue(torch.equal(a,b))
        self.assertTrue(torch.equal(auxiliary,normal[0]))
        with self.assertRaises(ValueError):model.enable_soft_policy()
        # Strip after actually updating the training-only heads and shared trunk.
        optimizer=torch.optim.AdamW(model.parameters(),lr=.001)
        F.cross_entropy(model.forward_with_aux(*inputs)[1],torch.tensor([3,160])).backward()
        self.assertGreater(model.input.weight.grad.abs().sum().item(),0.)
        optimizer.step()
        rng=torch.get_rng_state().clone();stripped=model.inference_model()
        self.assertTrue(torch.equal(rng,torch.get_rng_state()))
        self.assertEqual(sum(p.numel() for p in stripped.parameters()),120905)
        with torch.no_grad():
            for a,b in zip(model(*inputs),stripped(*inputs)):self.assertTrue(torch.equal(a,b))
        self.assertFalse(any(k.startswith('auxiliary_') for k in stripped.state_dict()))

    def prepared(self):
        rows=[item('a'),item('b')]
        for r in rows:
            r['x']=torch.randn(160,32)
            r['policy']=F.one_hot(torch.tensor(7),161).float()*.8+F.one_hot(torch.tensor(160),161).float()*.2
        return Prepared(rows,{('torus',7):torch.eye(160)},'cpu')

    def test_zero_weight_matches_ordinary_optimizer_trajectory_exactly(self):
        ordinary=GraphNet();auxiliary=copy.deepcopy(ordinary);auxiliary.enable_soft_policy()
        data=self.prepared();control=self.prepared()
        # Use identical examples; construction of test fixtures consumes RNG.
        control=copy.deepcopy(data);control.configure_soft_policy(4,0)
        optimizers=[torch.optim.AdamW(m.parameters(),lr=.00003,weight_decay=.0001) for m in (ordinary,auxiliary)]
        for step in range(3):
            for model,prepared,optimizer in zip((ordinary,auxiliary),(data,control),optimizers):
                optimizer.zero_grad()
                loss=prepared.forward(model,prepared.indices)[0].mean()
                loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),5);optimizer.step()
            for key,value in ordinary.state_dict().items():
                self.assertTrue(torch.equal(value,auxiliary.state_dict()[key]),key)

    def test_auxiliary_eligibility_and_common_selection_loss(self):
        model=GraphNet();model.enable_soft_policy()
        prepared=self.prepared()
        base=prepared.forward(model,prepared.indices)[0].detach()
        common=prepared.evaluate(model,2,common=True)
        prepared.policy_weight=torch.tensor([0.,2.])
        prepared.configure_soft_policy(4,1)
        normal=copy.deepcopy(prepared);normal.auxiliary_policy_weight=0
        normal_loss=normal.forward(model,normal.indices)[0].detach()
        soft_loss=prepared.forward(model,prepared.indices)[0]
        self.assertTrue(torch.equal(soft_loss[0].detach(),normal_loss[0]))
        self.assertGreater(soft_loss[1].item(),normal_loss[1].item())
        after=prepared.evaluate(model,2,common=True)
        self.assertEqual(common,after)
        model.zero_grad();soft_loss.mean().backward()
        self.assertGreater(model.auxiliary_policy[0].weight.grad.abs().sum().item(),0.)
        self.assertGreater(model.input.weight.grad.abs().sum().item(),0.)

if __name__=='__main__':unittest.main()
