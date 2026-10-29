import unittest
from train import mixed_generation_weights
from test_training import item as legacy_item

def item(*args,**kwargs):
 kwargs.setdefault("source","selfplay")
 return legacy_item(*args,**kwargs)

class FreshReplayTests(unittest.TestCase):
 def test_fresh_mix_keeps_board_mass_and_limits_shift_to_available_boards(self):
  records=[item('old-p1','plane',7),item('old-p2','plane',7),item('new-p','plane',7),item('curve','torus',7)]
  records[2]['record']['replayGeneration']=1
  w=mixed_generation_weights(records,.3)
  self.assertAlmostEqual(sum(w),1.)
  self.assertAlmostEqual(sum(w[:3]),.5)
  self.assertAlmostEqual(w[3],.5)
  self.assertAlmostEqual(w[2],.15)
  self.assertAlmostEqual(sum(w[:2]),.35)
 def test_legacy_only_comparator_keeps_original_board_weights(self):
  records=[item('a','plane',7),item('b','plane',7),item('c','torus',7)]
  self.assertEqual(mixed_generation_weights(records,.3),[.25,.25,.5])
 def test_fresh_origin_cannot_be_its_own_only_replay_or_other_generation(self):
  r=item('new');r['record']['replayGeneration']=1
  with self.assertRaises(ValueError):mixed_generation_weights([r],.3)
  r['record']['replayGeneration']=2
  with self.assertRaises(ValueError):mixed_generation_weights([r],.3)
  for f in (0.,1.,float('nan')):
   with self.assertRaises(ValueError):mixed_generation_weights([item('a')],f)
if __name__=='__main__':unittest.main()
