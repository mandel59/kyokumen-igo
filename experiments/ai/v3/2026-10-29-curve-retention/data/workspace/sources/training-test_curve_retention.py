import copy
import unittest
import torch
from model import GraphNet
from train import Prepared,curve_retention_loss
from test_training import item

class CurveRetentionTests(unittest.TestCase):
 def setUp(self):
  torch.set_num_threads(2);torch.manual_seed(31)
 def prepared(self):
  rows=[item('p','plane',7),item('c','torus',7)]
  for r in rows:
   r['x']=torch.randn(160,32);r['legal'][49:160]=False
  return Prepared(rows,{('plane',7):torch.eye(160),('torus',7):torch.eye(160)},'cpu')
 def test_teacher_frozen_and_plane_loss_unchanged(self):
  model=GraphNet();teacher=copy.deepcopy(model);p=self.prepared();p.cache_curve_anchor(teacher,2,1)
  frozen={k:v.clone() for k,v in teacher.state_dict().items()}
  with torch.no_grad():
   model.score[-1].bias.add_(.25);model.value[-1].bias[0].add_(.4);model.ownership[-1].bias[0].add_(.2)
  baseline=copy.deepcopy(p);baseline.curve_anchor_weight=0
  a=p.forward(model,p.indices)[0];b=baseline.forward(model,baseline.indices)[0]
  self.assertTrue(torch.equal(a[:1],b[:1]));self.assertGreater(a[1].item(),b[1].item())
  a.mean().backward()
  self.assertTrue(all(t.grad is None for t in teacher.parameters()))
  self.assertTrue(all(torch.equal(v,teacher.state_dict()[k]) for k,v in frozen.items()))
  self.assertFalse(any(v.requires_grad for v in p.curve_anchor.values()))
 def test_common_selection_excludes_retention_loss(self):
  model=GraphNet();teacher=copy.deepcopy(model);p=self.prepared();p.cache_curve_anchor(teacher,2,1)
  with torch.no_grad():model.score[-1].bias.add_(.3)
  baseline=copy.deepcopy(p);baseline.curve_anchor_weight=0
  self.assertEqual(p.evaluate(model,2,common=True),baseline.evaluate(model,2,common=True))
 def test_zero_weight_preserves_optimizer_trajectory(self):
  model=GraphNet();control=copy.deepcopy(model);p=self.prepared();q=copy.deepcopy(p);q.cache_curve_anchor(copy.deepcopy(model),2,0)
  opts=[torch.optim.AdamW(m.parameters(),lr=3e-5) for m in [model,control]]
  for step in range(3):
   for m,d,opt in zip([model,control],[p,q],opts):
    opt.zero_grad();d.forward(m,d.indices)[0].mean().backward();torch.nn.utils.clip_grad_norm_(m.parameters(),5);opt.step()
   self.assertTrue(all(torch.equal(v,control.state_dict()[k]) for k,v in model.state_dict().items()))
 def test_ownership_padding_and_illegal_policy_do_not_affect_retention(self):
  model=GraphNet();p=self.prepared();p.cache_curve_anchor(copy.deepcopy(model),2,1)
  d=p.data;output=model(d['x'],p.adjacency[p.boards],d['mask'],d['global_features'])
  original=curve_retention_loss(output,p.curve_anchor,d['legal'],d['mask'].squeeze(-1))
  changed=[v.clone() for v in output];changed[0][:,49:160]=100.;changed[3][:,49:]=100.
  actual=curve_retention_loss(changed,p.curve_anchor,d['legal'],d['mask'].squeeze(-1))
  torch.testing.assert_close(original,actual,atol=0,rtol=0)
 def test_retention_gradient_is_curve_only(self):
  model=GraphNet();p=self.prepared();p.cache_curve_anchor(copy.deepcopy(model),2,1)
  with torch.no_grad():model.score[-1].bias.add_(.2)
  x=p.data['x'].clone().requires_grad_()
  output=model(x,p.adjacency[p.boards],p.data['mask'],p.data['global_features'])
  loss=(curve_retention_loss(output,p.curve_anchor,p.data['legal'],p.data['mask'].squeeze(-1))*p.curve_mask).sum()
  loss.backward()
  self.assertEqual(x.grad[0].abs().sum().item(),0.)
  self.assertGreater(x.grad[1].abs().sum().item(),0.)
 def test_invalid_weights_and_missing_curve_roots(self):
  p=self.prepared()
  for weight in [-1,float('nan')]:
   with self.assertRaises(ValueError):p.cache_curve_anchor(GraphNet(),2,weight)
  rows=[item('p','plane',7)]
  p=Prepared(rows,{('plane',7):torch.eye(160)},'cpu')
  with self.assertRaises(ValueError):p.cache_curve_anchor(GraphNet(),1,1)

if __name__=='__main__':unittest.main()
