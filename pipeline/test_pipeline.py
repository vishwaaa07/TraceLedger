import json,unittest
from generate import generate
from train import features
class GeneratorTests(unittest.TestCase):
 def test_coherent_utxos_and_separate_seeds(self):
  records,labels=generate(99,35);txs={r['txid']:r for r in records};spent=set()
  for t in txs.values():
   if t['funding_boundary']:continue
   self.assertEqual(sum(t['input_amounts']),sum(t['output_amounts'])+t['fees'])
   for i in t['inputs']:
    key=(i['prev_txid'],i['prev_index']);self.assertNotIn(key,spent);spent.add(key)
    parent=txs[i['prev_txid']];out=parent['outputs'][i['prev_index']]
    self.assertEqual((i['address'],i['amount']),(out['address'],out['amount']));self.assertLess(parent['timestamp'],t['timestamp'])
  self.assertEqual(generate(99,35),(records,labels))
  other,_=generate(100,35);self.assertFalse(set(txs)&{r['txid'] for r in other})
 def test_labels_excluded_and_future_independent(self):
  rows,labels=generate(44,14);x,ids=features(rows);cut=sorted({r['timestamp'] for r in rows})[20];xp,idp=features([r for r in rows if r['timestamp']<=cut]);ref=dict(zip(ids,x.tolist()))
  for i,v in zip(idp,xp.tolist()):self.assertEqual(v,ref[i]);self.assertEqual(len(v),8)
if __name__=='__main__':unittest.main()
