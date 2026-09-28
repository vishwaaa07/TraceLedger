"""Fit normal references; choose threshold on development, never evaluation."""
import json, platform, time
import numpy as np
import sklearn, joblib
from sklearn.ensemble import IsolationForest
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import precision_score, recall_score
from generate import generate, write, ROOT
from representation import FEATURES, CONTEXT, raw_features, project, features

def metrics(y,s,threshold):
    y=np.asarray(y);s=np.asarray(s);pred=s>=threshold;k=max(1,round(len(y)*.05))
    tp=int(sum((y==1)&pred));fp=int(sum((y==0)&pred));fn=int(sum((y==1)&~pred));tn=int(sum((y==0)&~pred))
    return {'threshold':float(threshold),'precision':float(precision_score(y,pred,zero_division=0)),
      'recall':float(recall_score(y,pred,zero_division=0)), 'precision_at_k':float(np.mean(y[np.argsort(-s,kind='stable')[:k]])),
      'k':k,'false_positives':fp,'predicted_positive':int(sum(pred)),'true_positives':tp,'false_negatives':fn,'true_negatives':tn,
      'false_positive_rate':fp/max(1,fp+tn)}

def choose_threshold(y,s):
    candidates=[]
    for q in np.linspace(.90,.999,100):
        threshold=float(np.quantile(s[np.asarray(y)==0],q));m=metrics(y,s,threshold)
        p,r=m['precision'],m['recall'];f2=5*p*r/(4*p+r) if p+r else 0
        if m['false_positive_rate']<=.10:candidates.append((f2,-m['false_positive_rate'],threshold))
    return max(candidates)[2]

def main():
    start=time.perf_counter();out=ROOT/'public/model';out.mkdir(exist_ok=True,parents=True)
    old=out/'evaluation.json'
    if old.exists() and not (out/'evaluation-v1.json').exists(): (out/'evaluation-v1.json').write_bytes(old.read_bytes())
    data={};spec=[('training',81201,1400),('development',82402,420),('calibration',83603,420),('evaluation',84804,560),('sample',8542,280)]
    for name,seed,num in spec:
        rows,labels=generate(seed,num);raw,g,ids=raw_features(rows);y=np.array([labels[i]['target'] for i in ids])
        data[name]={'rows':rows,'labels':labels,'raw':raw,'graph':g,'ids':ids,'y':y,'seed':seed}
        folder=ROOT/'public/data' if name=='sample' else ROOT/'pipeline/datasets';write(rows,folder/name)
        (folder/f'{name}.labels.json').write_text(json.dumps(labels,separators=(',',':')))
    train=data['training'];normal=train['y']==0
    scaler=StandardScaler().fit(train['graph'][normal]);pca=PCA(n_components=4,svd_solver='full').fit(scaler.transform(train['graph'][normal]))
    embedding={'method':'past-only two-hop mean aggregation + PCA','dimensions':4,'mean':scaler.mean_.tolist(),'scale':scaler.scale_.tolist(),'pca_mean':pca.mean_.tolist(),'components':pca.components_.tolist(),'explained_variance_ratio':pca.explained_variance_ratio_.tolist()}
    for d in data.values(): d['x']=np.concatenate([d['raw'],project(d['graph'],embedding)],axis=1)
    candidates=[]
    for name,indices in [('context',list(range(13))),('context_graph',list(range(17)))]:
        model=IsolationForest(n_estimators=128,max_samples=512,random_state=1729,n_jobs=1).fit(train['x'][normal][:,indices])
        dev=data['development'];s=-model.score_samples(dev['x'][:,indices]);threshold=choose_threshold(dev['y'],s);m=metrics(dev['y'],s,threshold)
        p,r=m['precision'],m['recall'];f2=5*p*r/(4*p+r) if p+r else 0
        candidates.append((f2,name,indices,model,threshold,m))
    _,name,indices,model,threshold,_=max(candidates,key=lambda c:(c[0],c[1]))
    trees=[]
    for est in model.estimators_:
        t=est.tree_;trees.append({'left':t.children_left.tolist(),'right':t.children_right.tolist(),'feature':[indices[f] if f>=0 else -2 for f in t.feature],'threshold':t.threshold.tolist(),'samples':t.n_node_samples.tolist()})
    cal=data['calibration'];calibration=-model.score_samples(cal['x'][cal['y']==0][:,indices]);x=train['x'][normal]
    artifact={'version':'iforest-2.0.0','schema_version':2,'seed':1729,'features':FEATURES,'max_samples':512,'trees':trees,'embedding':embedding,'selected_representation':name,'selected_indices':indices,'calibration_scores':sorted(calibration.tolist()),'alert_threshold':threshold,
      'threshold_method':'development F2 maximisation with <=10% normal FPR; independent calibration percentile',
      'reference':{f:{'median':float(np.median(x[:,i])),'p05':float(np.quantile(x[:,i],.05)),'p95':float(np.quantile(x[:,i],.95))} for i,f in enumerate(FEATURES)},'direction':'larger is more anomalous'}
    (out/'isolation-forest.json').write_text(json.dumps(artifact,separators=(',',':')))
    ev=data['evaluation'];xe=ev['x'];scores=-model.score_samples(xe[:,indices]);y=ev['y']
    ablations={n:metrics(y,-mo.score_samples(xe[:,idx]),th) for _,n,idx,mo,th,_ in candidates}
    legacy=IsolationForest(n_estimators=64,max_samples=256,random_state=1729,n_jobs=1).fit(train['raw'][normal,:8])
    legacycal=-legacy.score_samples(cal['raw'][cal['y']==0,:8]);legacy_scores=-legacy.score_samples(ev['raw'][:,:8])
    stress=[]
    for seed in [85905,86006,87107]:
        rows,labels=generate(seed,210);xx,ids=features(rows,embedding);yy=[labels[i]['target'] for i in ids]
        stress.append({'seed':seed,'transactions':len(ids),**metrics(yy,-model.score_samples(xx[:,indices]),threshold)})
    report={'model_version':artifact['version'],'environment':{'python':platform.python_version(),'sklearn':sklearn.__version__,'platform':platform.platform()},
      'datasets':{n:{'records':len(d['rows']),'transactions':len(d['ids']),'seed':d['seed'],'normal':int(sum(d['y']==0)),'targets':int(sum(d['y']==1))} for n,d in data.items()},
      'label_definition':'burst or peeling non-funding transactions; synthetic patterns, not crime',
      'selection':'Two predeclared representations selected by development F2 under <=10% FPR. Evaluation and stress seeds excluded from fitting and selection.',
      'selected_representation':name,'development_candidates':{n:m for _,n,_,_,_,m in candidates},
      'isolation_forest':metrics(y,scores,threshold),'rule_baseline':metrics(y,((xe[:,6]>=3)|(xe[:,4]>=.94)).astype(float),.5),
      'legacy_features_new_data':metrics(y,legacy_scores,float(np.quantile(legacycal,.95))), 'embedding_ablation':ablations,'stress_seeds':stress,
      'by_scenario':{kind:metrics(y[mask],scores[mask],threshold) for kind in sorted(set(v['scenario'] for v in ev['labels'].values())) if (mask:=np.array([ev['labels'][i]['scenario']==kind for i in ev['ids']])).any()},
      'training_and_generation_seconds':time.perf_counter()-start}
    (out/'evaluation.json').write_text(json.dumps(report,indent=2))
    sample=data['sample'];(ROOT/'public/data/manifest.json').write_text(json.dumps({'transactions':len(sample['ids']),'observations':sum('observation_id' in r for r in sample['rows']),'seed':sample['seed'],'model':artifact['version']}))
    (out/'reference-scores.json').write_text(json.dumps({'tolerance':1e-10,'ids':ev['ids'][:100],'vectors':xe[:100].tolist(),'scores':scores[:100].tolist()},indent=2))
    (out/'feature-manifest.json').write_text(json.dumps({'order':FEATURES,'timestamp':'strictly prior transaction time; no equal/future neighbours','embedding':embedding,'context':CONTEXT,'missing':'missing fee=0 with warning; no parent gap=86400, depth=0; missing aggregates=zeros'},indent=2))
    joblib.dump(model,ROOT/'pipeline/isolation-forest.joblib')
    print(json.dumps({k:report[k] for k in ['selected_representation','development_candidates','isolation_forest','embedding_ablation','stress_seeds']},indent=2))
if __name__=='__main__':main()
