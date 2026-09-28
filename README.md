# TraceLedger

Offline Bitcoin transaction analysis built by **ByteBlasters** for SIH26146: *AI-Powered Monitoring & Analysis of Bitcoin Transaction Traffic*.

Import transaction and peer-observation records, inspect unusual activity, and follow recorded connections between transactions, addresses and relay IPs. Analysis runs in the browser. The bundled Isolation Forest is trained separately in Python.

## Features

- CSV, JSON and XML imports with column mapping, validation reports and duplicate handling.
- A sample investigation with 1,668 transactions and 3,011 peer observations.
- Model scores, supporting records, feature comparisons and evidence-quality indicators.
- An analyst workspace with automatic review guidance, editable notes and review status.
- Interactive graphs with individual output links, bounded neighbourhoods and entity search.
- Separate clustering, peeling/CoinJoin-like indicators and seed-exposure heuristics.
- IndexedDB case storage, case re-import, CSV/JSON exports and printable reports.
- Optional local Geo-IP lookup and Light, Dark and System themes.

Uploads stay in the browser. A relay IP does not establish wallet ownership. Alerts are leads for review, not conclusions about criminal activity.

## Run locally

Install Node.js **22.12 or newer** and npm. From the project folder:

```bash
npm ci
npm run dev
```

Open the URL printed by Vite, normally `http://127.0.0.1:5173`. Choose **Explore sample investigation** to run an analysis without uploading a file.

## Production build and offline use

```bash
npm run build
python serve.py
```

On Linux or macOS, use `python3 serve.py`. The server requires Python **3.10+**. Open `http://127.0.0.1:4173` and keep the terminal running. For a port conflict, use `python serve.py --port 4180` and open port 4180.

Do not open `index.html` directly. Modules and workers need an HTTP origin.

Once built, `dist` contains the app, model and sample data. Running it needs no internet, npm install or Python ML packages. `START_WINDOWS.bat` and `START_LINUX.sh` start the same server when a build is present.

Create a portable archive after building:

```bash
python pipeline/package_offline.py
```

Extract the archive, enter `trace-ledger-offline`, run `python3 serve.py` and open port 4173. Install Python and a browser before going offline. Native Linux execution still needs verification; the offline browser workflow was tested on Windows.

## Stack

| Area | Tools |
|---|---|
| Frontend | React, TypeScript, Vite, CSS |
| Graphs and charts | Cytoscape.js, Recharts |
| Parsing | Papa Parse, fast-xml-parser, ipaddr.js |
| Analysis | Web Workers, fitted-tree inference in TypeScript |
| Local storage | IndexedDB |
| Training | Python, scikit-learn, NumPy, SciPy, joblib |
| Tests | Vitest, Playwright |
| Hosting | Netlify |

JavaScript versions are locked in `package-lock.json`. Python versions are pinned in `pipeline/requirements.txt`. The app needs no API key, cloud database or separate analysis backend.

## Data

Imports accept up to **100 MiB and 100,000 source records**. Parsing runs in a worker but remains in memory. Graph rendering is limited to **180 nodes/blocks** at a time.

Transactions and network observations are separate. Repeated observations do not increase transaction values or counts. Amounts use integer satoshis: **1 BTC = 100,000,000 satoshis**.

The generator creates coherent synthetic output-spending relationships and keeps scenario labels separate from model features:

```bash
python pipeline/generate.py --seed 705 --scenarios 70 --output generated/case705
```

See [Data format](docs/DATA.md) for fields and CSV array conventions, and [Geo-IP](docs/GEOIP.md) for local enrichment. DB-IP Lite country and ASN databases are bundled for offline use. No live Bitcoin feed is bundled.

## Model

The included `iforest-2.0.0` is a fitted **Isolation Forest with 128 trees**. It uses 13 transaction and past-neighbourhood features. A separate learned four-dimensional graph embedding supports structural similarity search in Analyst workspace. It uses two-hop mean aggregation and PCA, not graph ownership inference.

Training, development, calibration and evaluation use independent seeds and complete scenarios. The threshold is selected on development data under a 10% normal false-positive constraint. Evaluation is not used for selection. The model without embedding dimensions performed better, so that is the deployed detector; both ablations are published.

Held-out synthetic evaluation: **3,403 transactions**, 1,296 burst/peeling targets.

| Metric | Isolation Forest v2 | Rule baseline |
|---|---:|---:|
| Precision | 83.62% | 50.12% |
| Recall | 78.40% | 62.81% |
| Precision at 170 | 91.18% | 53.53% |
| False positives | 199 | 810 |

Threshold: `0.5606097225400263`. Three additional seeds gave recall of 77.20–79.12%. These labels describe synthetic patterns, not criminality. The former 0.56% recall used a different, smaller benchmark; it is not a like-for-like improvement estimate. Retrained legacy features reached 5.40% recall on the new test set, at a different false-positive operating point. See the [model card](docs/MODEL_CARD.md) and [complete evaluation](public/model/evaluation.json).

The automatic analyst summary uses fixed guidance around model results, not an LLM. Feature comparisons support review; they are not causal model attribution. Real investigative effectiveness remains unverified.

### Reproduce training

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r pipeline/requirements.txt
python pipeline/train.py
python pipeline/evaluate.py
python pipeline/test_pipeline.py
```

On Windows, create the environment with `python -m venv .venv` and activate it with `.venv\Scripts\Activate.ps1` in PowerShell. Training regenerates the datasets, fitted model, browser export and reference fixtures. Only load trusted joblib files. Retraining is not required to run the supplied model.

## Tests

```bash
npm test
npm run build
```

For browser tests, run `python serve.py` in another terminal, then:

```bash
npm run test:e2e
```

Playwright uses installed Chrome by default. Tests cover imports, accounting, duplicate observations, prior-only features, model parity, graph evidence, exports, storage failures and the analyst workflow. Browser tests generate ignored screenshots and reports locally.

The inference suite compares 100 vectors with Python at a tolerance of `1e-10`, including learned graph coordinates. The bulk fixture contains 58,555 records and 30,653 transactions. Its 71 MB JSON browser workflow took 14.71 seconds on Chrome 153 / Windows 11 / Ryzen 5 PRO 8540U. CSV, JSON and XML scores match. These are individual runs, not guaranteed performance. See [Bulk imports](docs/BULK_IMPORT.md).

To use the real offline location database, open **Investigations → Local Geo-IP database → Load bundled Geo-IP databases**. Enter an IP or leave it blank to look up case peers. Synthetic documentation IPs correctly remain unavailable. See [Geo-IP licensing and updates](docs/GEOIP.md).

## Netlify

Keep `netlify.toml` in the repository. It sets the build command to `npm run build`, publish directory to `dist` and Node version to 22.

Connect the repository to the Netlify project. Leave the base directory empty when `package.json` is at the repository root. Netlify builds the source, so `dist` does not need to be committed. For a manual deployment, upload the locally built `dist` folder.

The project owner has deployed on Netlify. The hosted workflow has not been independently verified here. Do not commit deployment tokens or other secrets.

## Repository layout

```text
src/                 UI, worker, parser, inference and graph logic
public/data/         Samples and malformed-record fixture
public/model/        Browser model, manifest and reference scores
public/geo/          Licensed DB-IP Lite country/ASN snapshots
public/geo/          Licensed DB-IP Lite country/ASN snapshots
pipeline/            Generation, training, evaluation and packaging
pipeline/datasets/   Training, development, calibration and evaluation data
scripts/             Benchmarks and dependency-notice generation
tests/               Unit and browser tests
docs/                Architecture, schema, model and enrichment details
serve.py             Local static server
```

Build output, dependencies, credentials and test reports are excluded from Git. Dependency licence notices and Python requirements are intentionally retained.

## Limitations

- No live network capture, Bitcoin-node integration or consensus/signature validation.
- Inferred address groups and privacy-pattern heuristics can be wrong.
- No exact input-to-output fund allocation in complex transactions.
- Cases stay in the current browser and do not sync. Export backups before clearing storage.
- Case exports are not signed forensic chain-of-custody records.
- Native Linux and hosted end-to-end checks remain outstanding.

The supplied problem statement refers to a missing Section 4. No extra requirements have been assumed from it.
