"""Re-evaluate the saved fitted estimator without retraining."""
import json
import joblib
from train import features,metrics,ROOT
import numpy as np
model=joblib.load(ROOT/'pipeline/isolation-forest.joblib') # Only load this trusted locally generated artifact.
rows=json.loads((ROOT/'pipeline/datasets/evaluation.json').read_text())
labels=json.loads((ROOT/'pipeline/datasets/evaluation.labels.json').read_text())
x,ids=features(rows);y=[labels[i]['target'] for i in ids]
artifact=json.loads((ROOT/'public/model/isolation-forest.json').read_text())
result={'isolation_forest':metrics(y,-model.score_samples(x),artifact['alert_threshold']),'rule_baseline':metrics(y,((x[:,6]>=3)|(x[:,4]>=.94)).astype(float),.5)}
print(json.dumps(result,indent=2))
