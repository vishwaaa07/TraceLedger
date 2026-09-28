# Model card — iforest-1.0.0

## Intended use

Rank unusual transaction structure for human investigation of offline metadata. An anomaly is not criminality. This is an evaluated synthetic prototype, **not a validated operational detector**. No graph embeddings, specialised learned peeling detector, calibrated crime probability or model-attribution explanation is claimed.

## Training and artifact

scikit-learn 1.7.2 IsolationForest, 64 estimators, max_samples=256, random_state=1729, contamination='auto', n_jobs=1, default max_features=1.0, no bootstrap. Fixed synthetic training seed=1201; model fit uses 660 target=0 transactions from 1,020 total. Calibration uses 330 target=0 transactions from seed 2402. Evaluation seed=3603 includes all 510 transactions (180 target, 330 non-target). Complete scenarios are disjoint across splits. Training labels are used only to select the normal-reference population; no identifiers, IPs, labels or scenario names enter the eight features.

Fit/export: `python pipeline/train.py`. Independent saved-model evaluation: `python pipeline/evaluate.py`. Trusted Python fitted estimator: `pipeline/isolation-forest.joblib`. Browser artifact: `public/model/isolation-forest.json`, schema_version=1. Export contains left/right child indices, feature indices, thresholds, leaf sample counts, feature order, fixed sorted calibration scores, threshold and training reference statistics. Joblib is never loaded by the browser.

## Feature contract (exact order)

| Index | Feature | Formula / semantics |
|---:|---|---|
| 0 | log_output_sats | natural log(1 + sum of output satoshis) |
| 1 | input_count | Number of input objects |
| 2 | output_count | Number of outputs |
| 3 | log_fee_sats | natural log(1 + fee satoshis); missing uses 0 and warning |
| 4 | largest_output_share | max(output)/sum(output); 0 if total=0 |
| 5 | output_cv | Population standard deviation of outputs / mean; 0 if mean=0 |
| 6 | prior_address_1h | Across distinct participating addresses, count earlier transaction appearances in [t−3600 seconds,t); each address once per transaction |
| 7 | prior_parent_count | Number of inputs whose explicit parent exists and has strictly earlier transaction time; counts inputs, not distinct parent TXIDs |

Time is the supplied transaction event time normalized to UTC. It is not blockchain block time unless the supplier defines it that way. Observation timestamps are separate network evidence. Transactions process in timestamp/TXID order; same-time transactions cannot see each other in historical features. Features do not read future graph neighbours or future observations. The full graph/heuristics may use all imported evidence, but those retrospective results do not enter model features.

No standard scaling: tree splits operate on these transformed features. Every tree comparison uses float32-rounded feature values (`Math.fround`), matching scikit-learn's input conversion. Monetary accounting remains integer/BigInt; floating point is used only for statistical features/scores.

## Score and percentile

For each tree, traverse until a leaf. Path length = edge depth + c(leaf_sample_count), where c(0)=c(1)=0, c(2)=1, and for n>2, c(n)=2(log(n−1)+EulerGamma)−2(n−1)/n. Score=2^(−mean_path_length/c(256)), equal to **negative sklearn score_samples**. Higher is more anomalous. Calibration percentile=100 × number of fixed calibration scores ≤ score / 330 (right-continuous empirical CDF). It is not a probability.

Threshold=NumPy's linearly interpolated 95th percentile of normal calibration scores, **0.6126200911900463**. Threshold is independent of the uploaded dataset. Browser alert rule is score ≥ threshold; percentile is a display rank and is not a separate detection threshold.

100 fixed held-out vectors and Python reference scores are exported in `reference-scores.json`; TypeScript traversal must agree within **absolute error 1e-10**. Feature extraction is tested separately for no future/equal-time leakage. Tree artifact is deterministic for fixed versions/seeds; measured duration and environment metadata naturally vary.

## Measured synthetic evaluation

Target positives = non-funding burst or peeling scenario transactions. Other examples, including high-value, batch, consolidation and CoinJoin-like transactions, count as non-target. These labels do **not** define crime.

| Method | Threshold | Precision@26 | Precision | Recall | False positives | Flagged |
|---|---:|---:|---:|---:|---:|---:|
| Isolation Forest | 0.6126200911900463 | 0.384615 | 0.100000 | 0.005556 | 9 | 10 |
| Rule comparison | ≥0.5 on boolean rule | 0.384615 | 0.500000 | 0.750000 | 135 | 270 |

Comparison rule = (prior_address_1h ≥ 3 OR largest_output_share ≥ 0.94). K=round(0.05×510)=26. Python uses a stable descending sort for ties; generated evaluation IDs are timestamp/TXID ordered. Raw measurement: `public/model/evaluation.json`. No confidence intervals or calibrated likelihoods are estimated.

**Interpretation:** the fitted model poorly recovers these labelled structures at the fixed threshold. It often regards legitimate multi-input or other unusual transactions as anomalous; structurally frequent or unseen constant-feature patterns can evade Isolation Forest. The explicit pattern baseline has more recall at a large false-positive cost. This result is a limitation to disclose, not a reason to present the rules as the trained model. More realistic and diverse references, rigorous feature research and new untouched evaluation scenarios are needed before operational use.

The training reference choice was revised once during implementation after inspecting an initial all-scenario result. The final evaluation is therefore a development measurement, not a preregistered blind benchmark. No hyperparameter search or test-set optimization claim is made.

## Evidence quality and explanation

Evidence quality is a deterministic availability index: 25 structure + 25 known fee + up to 25 resolved input fraction + 25 for at least one valid network observation. Explicit initial funding boundaries get the reference component. It does not incorporate authenticity, sensor reliability or statistical confidence. A complete synthetic record can score 100 without implying truth or criminality.

The UI shows feature values alongside reference median/p05/p95, raw transaction source, normalized network evidence, timestamp range and validated graph links. These are **supporting observations**, not SHAP, attribution or causal explanations. Anomaly score, evidence quality and seed exposure are separate quantities.

Reference: [scikit-learn Isolation Forest API](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.IsolationForest.html) and [outlier detection guide](https://scikit-learn.org/stable/modules/outlier_detection.html#isolation-forest). The delivered code pins 1.7.2; current online docs may describe newer versions. The implementation is verified against the pinned Python estimator rather than assumed from documentation.
