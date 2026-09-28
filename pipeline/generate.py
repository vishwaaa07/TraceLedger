"""Reproducible synthetic UTXO scenarios. No address or scenario label is a feature."""
import argparse, csv, hashlib, json, random
from pathlib import Path
from datetime import datetime, timezone, timedelta
import xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[1]
def generate(seed=42, scenarios=70):
    rng=random.Random(seed); rows=[]; labels={}; base=datetime(2025,1,1,tzinfo=timezone.utc)
    def ident(s): return hashlib.sha256(f'{seed}:{s}'.encode()).hexdigest()
    def address(s): return 'synthetic_'+ident(s)[:30]
    for s in range(scenarios):
        kind=['ordinary','batch','high_value','consolidation','burst','peeling','coinjoin'][s%7]
        stamp=base+timedelta(minutes=s*180)
        # Legitimate lookalikes vary across independent scenarios as well as seeds.
        reuse=rng.random()<.30
        fast_normal=rng.random()<.18
        large_change=rng.random()<.20
        n=6 if kind in ['consolidation','coinjoin'] else 1
        value=rng.randint(10_000_000,90_000_000)*(100 if kind=='high_value' else 1)
        funding=ident(f'{s}:funding')
        outs=[{'index':i,'address':address(f'{s}:fund:{i}'),'amount':value} for i in range(n)]
        utxo=[(funding,o) for o in outs]
        def emit(txid,inputs,outputs,t,fee,boundary=False):
            tx={'timestamp':t.isoformat(),'txid':txid,'input_addresses':[i['address'] for i in inputs], 'output_addresses':[o['address'] for o in outputs], 'input_amounts':[i['amount'] for i in inputs], 'output_amounts':[o['amount'] for o in outputs], 'inputs':inputs,'outputs':outputs,'fees':fee,'script_type':'p2wpkh','funding_boundary':boundary,'synthetic':True}
            labels[txid]={'scenario':kind,'scenario_id':f'{seed}-{s}','target':int(kind in ['burst','peeling'] and not boundary)}
            count=0 if s%11==0 else rng.randint(1,3)
            if count==0: rows.append(tx)
            for j in range(count):
                rows.append({**tx,'observation_id':ident(txid+f':obs{j}'),'observation_timestamp':(t+timedelta(seconds=j)).isoformat(),'src_ip':f'192.0.2.{1+s%250}','dst_ip':f'198.51.100.{1+j}','src_port':40000+s%20000,'dst_port':8333,'observer_id':'synthetic-sensor','geo_country':'ZZ','asn':64512,'geo_provenance':'simulated'})
        emit(funding,[],outs,stamp,0,True)
        for step in range(rng.randint(6,10) if kind in ['burst','peeling'] else rng.randint(2,6)):
            stamp+=timedelta(seconds=rng.randint(2,25) if kind=='burst' or (fast_normal and step<2) else rng.randint(120,5400))
            txid=ident(f'{s}:{step}'); chosen=utxo if step==0 and n>1 else [utxo[-1]]
            inputs=[{'prev_txid':p,'prev_index':o['index'],'address':o['address'],'amount':o['amount']} for p,o in chosen]
            total=sum(i['amount'] for i in inputs)
            if total<5000: break  # Stop depleted branches rather than emit negative outputs.
            fee=min(rng.randint(200,1800),total//20)
            count=6 if kind=='coinjoin' else rng.randint(6,12) if kind=='batch' else 1 if kind=='consolidation' else 2
            available=total-fee
            if kind=='peeling' or (large_change and step<2 and count==2):
                a=int(available*rng.uniform(.015,.09));amounts=[a,available-a]
            elif count==2:
                a=int(available*rng.uniform(.2,.65)); amounts=[a,available-a]
            else:
                amounts=[available//count]*count; amounts[-1]+=available-sum(amounts)
            outs=[{'index':i,'address':address(f'{s}:{step}:{i}'),'amount':a} for i,a in enumerate(amounts)]
            # Burst reuses a receiver, providing strictly historical activity signals.
            if kind=='burst' or reuse: outs[-1]['address']=address(f'{s}:reused')
            for u in chosen: utxo.remove(u)
            utxo += [(txid,o) for o in outs]
            emit(txid,inputs,outs,stamp,fee)
    return rows,labels

def write(rows,path):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.with_suffix('.json').write_text(json.dumps(rows,separators=(',',':')))
    keys=list(dict.fromkeys(k for r in rows for k in r))
    with path.with_suffix('.csv').open('w',newline='') as f:
        w=csv.DictWriter(f,keys); w.writeheader()
        for r in rows: w.writerow({k:json.dumps(v,separators=(',',':')) if isinstance(v,(list,dict,bool)) else v for k,v in r.items()})
    root=ET.Element('records')
    for r in rows:
        el=ET.SubElement(root,'record')
        for k,v in r.items(): ET.SubElement(el,k).text=json.dumps(v,separators=(',',':')) if isinstance(v,(list,dict,bool)) else str(v)
    ET.ElementTree(root).write(path.with_suffix('.xml'),encoding='unicode')
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--seed',type=int,default=8542);p.add_argument('--scenarios',type=int,default=280);p.add_argument('--output',default=str(ROOT/'public/data/sample'));a=p.parse_args()
    rows,labels=generate(a.seed,a.scenarios);write(rows,Path(a.output));Path(a.output+'.labels.json').write_text(json.dumps(labels,indent=2))
    if Path(a.output).resolve()==(ROOT/'public/data/sample').resolve():
        artifact=ROOT/'public/model/isolation-forest.json'
        (ROOT/'public/data/manifest.json').write_text(json.dumps({'transactions':len(labels),'observations':sum('observation_id' in r for r in rows),'seed':a.seed,'model':json.loads(artifact.read_text())['version'] if artifact.exists() else 'unavailable'}))
