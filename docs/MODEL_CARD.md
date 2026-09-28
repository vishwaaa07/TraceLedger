# Model card — iforest-2.0.0

## Intended use

Rank unusual metadata for human review, using synthetic structural labels for development evaluation. No crime probabilities, person identification, graph ownership inference or operational crime-detection accuracy are claimed.

## Data and fitting

The generator varies chain length, fees, payment fractions and timing. Legitimate scenarios include reused addresses, short fast sequences and large-change lookalikes. Target scenarios contain repeated burst or peeling structures. Initial funding boundaries are non-target. Depleted branches stop before producing invalid outputs. IDs and scenario labels never enter features.

| Split | Seed | Transactions | Non-target | Target |
|---|---:|---:|---:|---:|
| training | 81201 | 8541 | 5339 | 3202 |
| development | 82402 | 2543 | 1566 | 977 |
| calibration | 83603 | 2557 | 1596 | 961 |
| evaluation | 84804 | 3403 | 2107 | 1296 |
| sample | 8542 | 1668 | 1036 | 632 |

The detector fits only the 5,339 non-target training transactions. StandardScaler and four-component PCA also fit only their graph descriptors. This uses synthetic labels for reference selection; it is not a label-free data preparation claim. scikit-learn 1.7.2, NumPy 2.3.3; 128 Isolation Forest trees, max_samples=512, random_state=1729, n_jobs=1.

Two candidates were declared before evaluation: 13 contextual features, or those features plus four graph embedding coordinates. Development selects the candidate and threshold by F2 under <=10% non-target false-positive rate. Threshold candidates are development-normal score quantiles from 0.90 to 0.999. Independent normal calibration scores determine displayed percentiles, not the alert threshold. A rounding allowance in the first implementation was corrected to enforce the exact 10% development constraint; no evaluation scores chose that correction.

The context-only candidate wins on development. Graph embeddings remain implemented and exposed through similar-structure search. We do not claim that embeddings improve detection.

## Feature contract

The first eight features retain their order: log_output_sats, input_count, output_count, log_fee_sats, largest_output_share, output_cv, prior_address_1h, prior_parent_count. Amount and fee use log1p; output_cv is population SD/mean. Missing fee uses zero with a warning. Address history counts earlier appearances in [t-3600,t), once per distinct address per transaction. Parent count counts input references, not unique parents.

Five added features: log_parent_gap_seconds (log1p minimum parent age, capped/default 86400); prior_chain_depth (longest known parent path, capped 20); parent_mean_output_share; prior_fast_chain (consecutive parent steps with gap <60 seconds, capped 20); prior_retained_chain (consecutive >=90% largest-output share steps, capped 20). These are observed context, not scenario labels. The trained forest determines the score; no rule replaces its inference.

Transaction timestamps define history. Equal/future parents and equal/future address appearances are excluded. Missing parents contribute neither links nor fabricated context. Roots have depth zero and missing aggregates are zero. A retrospective display graph does not feed future data into features.

## Graph embedding method

Each transaction has six attributes: log1p(input count), log1p(output count), largest-output share, log1p(prior address activity), log1p(parent gap), log1p(capped depth). Concatenate these with means over earlier input parents and their earlier-parent mean attributes: an 18-dimensional, directed two-hop descriptor. Input references weight aggregation; duplicate inputs referencing different outputs of one parent contribute separately. Missing neighbourhoods are zero.

Transform the descriptor using the fitted training standardisation, then a fitted four-component PCA projection. The export includes means, scales, PCA centring and component matrix. This is a learned attributed-graph representation with deterministic mean aggregation, not Node2Vec, GraphSAGE or a trained GNN. It is inductive: new graphs use the same projection without retraining. No IDs or global future adjacency enter the representation.

Analyst workspace computes Euclidean nearest neighbours in these four coordinates inside the worker. Distance indicates structural similarity only; it creates no ownership or spending edges. Python/TypeScript parity tests cover the entire feature vector, including embeddings, and removal of parent evidence changes embeddings.

## Score and export

Raw score = 2^(-mean adjusted isolation path length / c(512)), equal to negative sklearn score_samples. The usual Isolation Forest c(n) correction uses Euler's constant, with c(0)=c(1)=0 and c(2)=1. Tree comparisons round features to float32. Accounting remains integer/BigInt.

Percentile = 100 × fraction of fixed normal calibration scores <= raw score. Alert threshold = 0.5606097225400263. It is not a probability. The model artifact has schema_version=2 and 17 feature slots, although the selected forest splits only on the first 13. A matching model version is required for case re-import; old cases need their original version or source-data reanalysis.

## Evaluation

| Method | Precision | Recall | Precision@170 | FP | Normal FPR |
|---|---:|---:|---:|---:|---:|
| Selected context forest | 83.62% | 78.40% | 91.18% | 199 | 9.44% |
| Context + graph embedding | 83.45% | 73.53% | 84.12% | 189 | 8.97% |
| Simple rule | 50.12% | 62.81% | 53.53% | 810 | 38.44% |
| Legacy eight features, retrained on new data | 40.23% | 5.40% | 40.00% | 104 | 4.94% |

The rule is prior_address_1h >=3 OR largest_output_share >=0.94. Operating points differ; compare false-positive workload as well as recall. The selected model detects 1,016 targets, misses 280 and flags 199 non-targets. Per-scenario counts are in evaluation.json. Three further seeds (85905, 86006, 87107) yield 77.20–79.12% recall and 82.46–85.02% precision. Evaluation/stress scenarios are excluded from fitting and selection, but share the same synthetic generator family. They do not establish generalisation to real cases.

The v1 report is retained as evaluation-v1.json. Its 0.56% recall used a different generator and test population, so a direct percentage-point improvement claim would confound data and model changes. The new model still has false positives, synthetic-feature bias and blind spots at early chain steps. Independently sourced data, governance review and expert validation are required before operational use.

## Reproduce

Run `python pipeline/train.py`, `python pipeline/evaluate.py`, `python pipeline/test_pipeline.py`, then `npm test`. Training regenerates data and artifacts. Tests compare 100 fixed Python scores and all 17 TypeScript features with absolute tolerance 1e-10, including no-future/equal-time leakage. Graph embeddings and evaluation reports are exported with the fitted model.

Evidence quality remains an availability index, not statistical confidence: 25 structure, 25 known fee, up to 25 resolved references and 25 valid network observation. Feature/reference comparisons are supporting observations, not causal attribution. References: scikit-learn IsolationForest and PCA implementations pinned in pipeline/requirements.txt.
