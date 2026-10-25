import gzip
import json
from pathlib import Path
import tempfile
import unittest
import torch
from model import GraphNet
from train import Prepared, load_data, loss_for, sampling_weights, split_games, surprise_weights


def item(game, kind='torus', size=7, source='teacher', score=0., ply=0):
    n=6*size*size+2 if kind=='sphere' else size*size
    return dict(record=dict(gameId=game,kind=kind,size=size,source=source,wdl=1 if score==0 else 0 if score>0 else 2,score=score,ply=ply),n=n,
        x=torch.zeros(160,32),mask=torch.cat((torch.ones(n,1),torch.zeros(160-n,1))),global_features=torch.zeros(8),
        legal=torch.ones(161,dtype=torch.bool),policy=torch.nn.functional.one_hot(torch.tensor(160),161).float(),own=torch.ones(160,dtype=torch.long))


class TrainingTests(unittest.TestCase):
    def test_surprise_keeps_domain_mass_and_uniform_floor(self):
        records=[item('teacher')]+[item('s'+str(i),source='selfplay') for i in range(4)]
        for i,r in enumerate(records):
            r['record'].update(replayGeneration=i%2,policySurprise=float(i==4)*10)
        base=sampling_weights(records,.6,True)
        weighted=surprise_weights(records,base,.5)
        self.assertEqual(weighted[0],base[0])
        self.assertGreater(weighted[4],base[4])
        self.assertTrue(all(w>=.5*b for w,b in zip(weighted,base)))
        for generation in [0,1]:
            ix=[i for i,r in enumerate(records) if r['record']['source']=='selfplay' and r['record']['replayGeneration']==generation]
            self.assertAlmostEqual(sum(weighted[i] for i in ix),sum(base[i] for i in ix))
        records[4]['record']['policyEligible']=False
        self.assertEqual(surprise_weights(records,base,.5),base)
        records[4]['record']['policySurprise']=float('nan')
        with self.assertRaises(ValueError):surprise_weights(records,base,.5)

    def test_replay_generations_keep_half_the_selfplay_mass_despite_unequal_counts(self):
        records=[item('teacher') for _ in range(3)]
        for generation,count in [(1,6),(2,30)]:
            for i in range(count):
                r=item('self-'+str(generation),source='selfplay')
                r['record']['replayGeneration']=generation;r['policy_weight']=float(i==0)
                records.append(r)
        weights=sampling_weights(records,.5,True)
        prepared=Prepared(records,{('torus',7):torch.eye(160)},'cpu',True);prepared.balance_policy(weights)
        for generation in [1,2]:
            indices=[i for i,r in enumerate(records) if r['record'].get('replayGeneration')==generation]
            self.assertAlmostEqual(sum(weights[i] for i in indices),.25)
            self.assertAlmostEqual(sum(weights[i]*prepared.policy_weight[i].item() for i in indices),.25)

    def test_nonfinite_evaluation_cannot_select_a_checkpoint(self):
        torch.set_num_threads(2);model=GraphNet().eval()
        with torch.no_grad():model.passing[-1].bias.fill_(float('nan'))
        data=Prepared([item('a')],{('torus',7):torch.eye(160)},'cpu')
        with self.assertRaisesRegex(ValueError,'Nonfinite validation'):
            data.evaluate(model,1,common=True)

    def test_common_selection_ignores_certified_roots_training_targets_and_anchor(self):
        torch.set_num_threads(2);torch.manual_seed(8);model=GraphNet().eval()
        a=item('normal');a['selection_policy']=torch.nn.functional.one_hot(torch.tensor(7),161).float()
        first=Prepared([a],{('torus',7):torch.eye(160)},'cpu')
        expected=first.evaluate(model,2,common=True)
        b=item('normal');b['policy']=torch.nn.functional.one_hot(torch.tensor(2),161).float();b['selection_policy']=a['selection_policy']
        certified=item('forced',score=-40);certified['record']['decisionReason']='certified-loss'
        second=Prepared([b,certified],{('torus',7):torch.eye(160)},'cpu')
        second.anchor_policy(GraphNet().eval(),2,100.)
        actual=second.evaluate(model,2,common=True)
        self.assertEqual(actual,expected)

    def test_policy_subsampling_preserves_each_source_mass(self):
        records=[item('teacher',source='teacher') for _ in range(4)]+[item('self',source='selfplay') for _ in range(8)]
        for i,r in enumerate(records):
            r['policy_weight']=float(i<4 or i==4 or i==7)
        weights=sampling_weights(records,.5)
        prepared=Prepared(records,{('torus',7):torch.eye(160)},'cpu');prepared.balance_policy(weights)
        for source in ['teacher','selfplay']:
            mass=sum(w*prepared.policy_weight[i].item() for i,(w,r) in enumerate(zip(weights,records)) if r['record']['source']==source)
            self.assertAlmostEqual(mass,.5)
        self.assertEqual(prepared.policy_weight[5].item(),0.)

    def test_pinned_split_never_promotes_old_training_games_to_validation(self):
        records=[item(game) for game in ['old-train','old-val']+[f'new-{i}' for i in range(10)]]
        train,val=split_games(records,42,dict(trainGames=['old-train'],validationGames=['old-val']))
        self.assertIn('old-train',{r['record']['gameId'] for r in train})
        self.assertIn('old-val',{r['record']['gameId'] for r in val})
        self.assertFalse({r['record']['gameId'] for r in train}&{r['record']['gameId'] for r in val})
        self.assertEqual(len(val),3)
        branch=item('old-val');branch['record']['sequenceId']='old-val-cleanup'
        a,b=split_games(records+[branch],42,dict(trainGames=['old-train'],validationGames=['old-val']))
        self.assertEqual(sum(r['record']['gameId']=='old-val' for r in b),2)
        self.assertFalse(any(r['record']['gameId']=='old-val' for r in a))
        with self.assertRaisesRegex(ValueError,'overlap'):
            split_games(records,42,dict(trainGames=['old-train'],validationGames=['old-train']))

    def test_split_qualifies_game_ids_by_board(self):
        records=[item(game,kind,size) for kind,size in [('torus',7),('sphere',3)] for game in ['same-a','same-b','same-c','same-d','same-e']]
        train,val=split_games(records,3)
        self.assertEqual(len(train),8);self.assertEqual(len(val),2)
        self.assertEqual({r['record']['kind'] for r in val},{'sphere','torus'})

    def test_sampling_equalizes_sources_boards_games_and_thirds(self):
        records=[item('teacher-short',source='teacher') for _ in range(3)]
        records += [item('teacher-long',source='teacher') for _ in range(30)]
        records += [item('self-small',source='selfplay') for _ in range(6)]
        records += [item('self-big',kind='sphere',size=5,source='selfplay') for _ in range(60)]
        weights=sampling_weights(records,.7)
        self.assertAlmostEqual(sum(weights),1.)
        self.assertAlmostEqual(sum(w for w,r in zip(weights,records) if r['record']['source']=='selfplay'),.7)
        for game,expected in [('teacher-short',.15),('teacher-long',.15),('self-small',.35),('self-big',.35)]:
            selected=[w for w,r in zip(weights,records) if r['record']['gameId']==game]
            self.assertAlmostEqual(sum(selected),expected)
            self.assertAlmostEqual(sum(selected[:len(selected)//3]),expected/3)

    def test_cached_loss_matches_reference_and_soft_targets_backpropagate(self):
        torch.set_num_threads(2);torch.manual_seed(4)
        records=[item('a'),item('b',kind='sphere',size=3)]
        records[0]['policy'][0]=.25;records[0]['policy'][160]=.75
        adjacency={('torus',7):torch.eye(160),('sphere',3):torch.eye(160)}
        model=GraphNet();cached=Prepared(records,adjacency,'cpu')
        expected=loss_for(model,records,adjacency)
        actual=cached.forward(model,cached.indices)[0].mean()
        torch.testing.assert_close(actual,expected)
        actual.backward();self.assertTrue(all(p.grad is not None and torch.isfinite(p.grad).all() for p in model.parameters()))
        metrics=cached.evaluate(model,2)
        self.assertAlmostEqual(metrics['loss'],metrics['unweightedLoss'])
        self.assertTrue(all(isinstance(v,(float,int)) for v in metrics.values()))

    def test_uncertain_policy_does_not_train_heads_but_still_trains_value(self):
        torch.set_num_threads(2);model=GraphNet()
        records=[item('a')];records[0]['policy_weight']=0.
        cached=Prepared(records,{('torus',7):torch.eye(160)},'cpu')
        cached.forward(model,cached.indices)[0].mean().backward()
        self.assertTrue(all(p.grad is not None and p.grad.abs().sum()==0 for p in list(model.policy.parameters())+list(model.passing.parameters())))
        self.assertGreater(model.value[-1].bias.grad.abs().sum().item(),0)

    def test_policy_anchor_is_zero_for_teacher_and_penalizes_drift(self):
        torch.set_num_threads(2);torch.manual_seed(3)
        teacher=GraphNet().eval();records=[item('a')]
        cached=Prepared(records,{('torus',7):torch.eye(160)},'cpu')
        cached.policy_weight.zero_();cached.anchor_policy(teacher,1,.5)
        _, outputs, d=cached.forward(teacher,cached.indices)
        logits=outputs[0].detach().clone().requires_grad_(True)
        from train import loss_terms
        args=[*outputs,d['legal'],d['policy'],cached.outcome,cached.score,d['own'],d['mask'].squeeze(-1)]
        base=loss_terms(*args,cached.policy_weight).item()
        anchored=loss_terms(*args,cached.policy_weight,cached.anchor,.5).item()
        self.assertAlmostEqual(base,anchored,places=5)
        changed=outputs[0].clone();changed[:,160]+=5
        shifted=loss_terms(changed,*outputs[1:],*args[4:],cached.policy_weight,cached.anchor,.5).item()
        self.assertGreater(shifted,anchored+.1)

    def test_gzip_loading_rejects_inconsistent_labels_and_compacts_records(self):
        row=dict(schemaVersion=1,kind='torus',size=7,gameId='a',x=[0.]*(49*32),legal=[True]*161,action=160,
            ownership=[1]*49,wdl=1,score=0.,**{'global':[0.]*8})
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'data.jsonl.gz'
            with gzip.open(path,'wt',encoding='utf-8') as out:out.write(json.dumps(row)+'\n')
            loaded=load_data([path]);self.assertNotIn('x',loaded[0]['record']);self.assertEqual(loaded[0]['record']['source'],'teacher')
            row['score']=1;row['wdl']=0
            with gzip.open(path,'wt',encoding='utf-8') as out:out.write(json.dumps(row)+'\n')
            with self.assertRaisesRegex(ValueError,'Ownership'):
                load_data([path])

    def test_sharpening_keeps_raw_visits_and_gates_only_uncertain_policy(self):
        row=dict(schemaVersion=1,kind='torus',size=7,gameId='a',source='selfplay',x=[0.]*(49*32),legal=[True]*161,
            ownership=[1]*49,wdl=1,score=0.,policy=[.5,.3]+[0.]*158+[.2],**{'global':[0.]*8})
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'data.jsonl';path.write_text(json.dumps(row)+'\n',encoding='utf-8')
            r=load_data([path],.5,.6)[0]
        self.assertEqual(r['policy_weight'],0.)
        self.assertAlmostEqual(r['raw_policy'][0].item(),.5)
        self.assertAlmostEqual(r['policy'][0].item(),.25/.38,places=6)
        self.assertEqual(r['record']['wdl'],1)


if __name__=='__main__':unittest.main()
