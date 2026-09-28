"""Train, export and evaluate IsolationForest; all scores are anomaly, not crime probabilities."""
import json, math, platform, time
from pathlib import Path
import numpy as np
import sklearn
from sklearn.ensemble import IsolationForest
from sklearn.metrics import precision_score, recall_score, confusion_matrix
from generate import generate,write,ROOT
FEATURES=['log_output_sats','input_count','output_count','log_fee_sats','largest_output_share','output_cv','prior_address_1h','prior_parent_count']
def features(rows):
    txs={r['txid']:r for r in rows}; history={}; seen=set(); vectors=[];ids=[]
    # Equal timestamps do not see each other: strict prior event semantics.
    from datetime import datetime
    ordered=sorted(txs.values(),key=lambda t:(t['timestamp'],t['txid']))
    for tx in ordered:
        now=datetime.fromisoformat(tx['timestamp']).timestamp(); amounts=tx['output_amounts']; total=sum(amounts); mean=total/len(amounts)
        cv=math.sqrt(sum((a-mean)**2 for a in amounts)/len(amounts))/mean if mean else 0
        addresses=set(tx['input_addresses']+tx['output_addresses'])
        activity=sum(sum(now-3600<=v<now for v in history.get(a,[])) for a in addresses)
        parents=sum(i['prev_txid'] in seen and datetime.fromisoformat(txs[i['prev_txid']]['timestamp']).timestamp()<now for i in tx['inputs'])
        vectors.append([math.log1p(total),len(tx['inputs']),len(amounts),math.log1p(tx['fees']),max(amounts)/total if total else 0,cv,activity,parents]);ids.append(tx['txid'])
        for a in addresses: history.setdefault(a,[]).append(now)
        seen.add(tx['txid'])
    return np.array(vectors),ids

def metrics(y,s,threshold):
    pred=np.array(s)>=threshold;k=max(1,round(len(y)*.05)); ranked=np.argsort(-np.array(s),kind='stable')[:k]
    return {'threshold':float(threshold),'precision':float(precision_score(y,pred,zero_division=0)),'recall':float(recall_score(y,pred,zero_division=0)),'precision_at_k':float(np.mean(np.array(y)[ranked])),'k':k,'false_positives':int(sum((np.array(y)==0)&pred)),'predicted_positive':int(sum(pred))}

def main():
    start=time.perf_counter(); data={}
    for name,seed,num in [('training',1201,210),('calibration',2402,105),('evaluation',3603,105),('sample',42,35)]:
        rows,labels=generate(seed,num); x,ids=features(rows);data[name]=(rows,labels,x,ids)
        folder=ROOT/'public/data' if name=='sample' else ROOT/'pipeline/datasets'
        write(rows,folder/name);(folder/f'{name}.labels.json').write_text(json.dumps(labels,indent=2))
    x=data['training'][2][[data['training'][1][i]['target']==0 for i in data['training'][3]]];model=IsolationForest(n_estimators=64,max_samples=256,random_state=1729,contamination='auto',n_jobs=1).fit(x)
    calibration=-model.score_samples(data['calibration'][2][[data['calibration'][1][i]['target']==0 for i in data['calibration'][3]]]); threshold=float(np.quantile(calibration,.95))
    trees=[]
    for est in model.estimators_:
        t=est.tree_;trees.append({'left':t.children_left.tolist(),'right':t.children_right.tolist(),'feature':t.feature.tolist(),'threshold':t.threshold.tolist(),'samples':t.n_node_samples.tolist()})
    artifact={'version':'iforest-1.0.0','schema_version':1,'seed':1729,'features':FEATURES,'max_samples':256,'trees':trees,'calibration_scores':sorted(calibration.tolist()),'alert_threshold':threshold,'reference':{f:{'median':float(np.median(x[:,i])),'p05':float(np.quantile(x[:,i],.05)),'p95':float(np.quantile(x[:,i],.95))} for i,f in enumerate(FEATURES)},'direction':'larger is more anomalous','preprocessing':'log1p on total output and fee; others unscaled; float32 at tree comparisons'}
    out=ROOT/'public/model';out.mkdir(exist_ok=True,parents=True);(out/'isolation-forest.json').write_text(json.dumps(artifact,separators=(',',':')))
    xe=data['evaluation'][2];ids=data['evaluation'][3];y=[data['evaluation'][1][i]['target'] for i in ids];scores=-model.score_samples(xe)
    baseline=((xe[:,6]>=3)|(xe[:,4]>=.94)).astype(float)
    report={'model_version':artifact['version'],'environment':{'python':platform.python_version(),'sklearn':sklearn.__version__,'platform':platform.platform()},'datasets':{n:{'records':len(d[0]),'transactions':len(d[3]),'seed':s} for (n,d),s in zip(data.items(),[1201,2402,3603,42])},'label_definition':'burst or peeling scenario non-funding transaction; synthetic structural scenarios, not criminality','isolation_forest':metrics(y,scores,threshold),'rule_baseline':metrics(y,baseline,.5),'training_and_generation_seconds':time.perf_counter()-start}
    (out/'evaluation.json').write_text(json.dumps(report,indent=2));(out/'reference-scores.json').write_text(json.dumps({'tolerance':1e-10,'ids':ids[:100],'vectors':xe[:100].tolist(),'scores':scores[:100].tolist()},indent=2))
    (out/'feature-manifest.json').write_text(json.dumps({'order':FEATURES,'timestamp':'transaction timestamp, strictly prior only; equal times excluded','missing':'fee missing uses log1p(0) and evidence warning; prior count only explicit validated references'},indent=2))
    import joblib
    joblib.dump(model,ROOT/'pipeline/isolation-forest.joblib')
    print(json.dumps(report,indent=2))
if __name__=='__main__': main()


