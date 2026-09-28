# TraceLedger

Offline Bitcoin transaction analysis built by **ByteBlasters** for SIH26146: *AI-Powered Monitoring & Analysis of Bitcoin Transaction Traffic*.

Import transaction and peer-observation records, inspect unusual activity, and follow recorded connections between transactions, addresses and relay IPs. Analysis runs in the browser. The bundled Isolation Forest is trained separately in Python.

## Features

- CSV, JSON and XML imports with column mapping, validation reports and duplicate handling.
- A sample investigation with 170 transactions and 284 peer observations.
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

Imports accept up to **50 MiB and 50,000 source records**. Parsing runs in a worker but remains in memory. Graph rendering is limited to **180 nodes/blocks** at a time.

Transactions and network observations are separate. Repeated observations do not increase transaction values or counts. Amounts use integer satoshis: **1 BTC = 100,000,000 satoshis**.

The generator creates coherent synthetic output-spending relationships and keeps scenario labels separate from model features:

```bash
python pipeline/generate.py --seed 705 --scenarios 70 --output generated/case705
```

See [Data format](docs/DATA.md) for fields and CSV array conventions, and [Geo-IP](docs/GEOIP.md) for local enrichment. No real location database or live Bitcoin feed is bundled.

## Model

The included `iforest-1.0.0` is a fitted **Isolation Forest with 64 trees**. It uses eight features, including transformed amounts, input/output counts, output distribution and prior address activity. The browser evaluates exported trees and compares scores with a fixed calibration set.

The automatic analyst summary uses fixed guidance around these results. It is not an LLM response. Feature comparisons are supporting observations, not causal model attributions.

Held-out synthetic evaluation used 510 transactions:

| Metric | Isolation Forest | Rule baseline |
|---|---:|---:|
| Precision | 10% | 50% |
| Recall | 0.56% | 75% |
| Precision at 26 | 38.46% | 38.46% |
| False positives | 9 | 135 |

The model threshold is `0.6126200911900463`. Labels identify synthetic burst/peeling scenarios, not criminality. Recall is low and further development is needed before real investigative use. See the [model card](docs/MODEL_CARD.md) and [evaluation artifact](public/model/evaluation.json).

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

The inference suite compares 100 vectors with Python at a tolerance of `1e-10`. A measured bulk fixture contained 23,227 records and 12,142 transactions. Its JSON browser workflow took 10.21 seconds on Chrome 153 / Windows 11 / Ryzen 5 PRO 8540U. CSV, JSON and XML produced matching scores. These are individual runs, not guaranteed performance. Details are in [Bulk imports](docs/BULK_IMPORT.md).

## Netlify

Keep `netlify.toml` in the repository. It sets the build command to `npm run build`, publish directory to `dist` and Node version to 22.

Connect the repository to the Netlify project. Leave the base directory empty when `package.json` is at the repository root. Netlify builds the source, so `dist` does not need to be committed. For a manual deployment, upload the locally built `dist` folder.

The project owner has deployed on Netlify. The hosted workflow has not been independently verified here. Do not commit deployment tokens or other secrets.

## Repository layout

```text
src/                 UI, worker, parser, inference and graph logic
public/data/         Samples and malformed-record fixture
public/model/        Browser model, manifest and reference scores
pipeline/            Generation, training, evaluation and packaging
pipeline/datasets/   Training, calibration and evaluation data
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
