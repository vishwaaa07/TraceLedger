# Bulk metadata verification

CSV, JSON and XML imports accept up to **50 MiB and 50,000 source records per file**. Preview, validation and scoring run in the Web Worker. Validation reports completed row counts. Cancel/reset terminates the worker. These are bounded in-memory imports, not streaming or a promise of million-record browser capacity. Graph views stay bounded to 180 displayed blocks.

Measured fixture: seed 884, 2,500 complete scenarios, 23,227 source records, 12,142 unique transactions, 22,117 network observations, zero rejected rows. Equivalent CSV/JSON/XML imports produced identical transaction scores.

| Format | File bytes | Parse + validation + analysis |
|---|---:|---:|
| JSON | 28,439,357 | 5.96 seconds |
| CSV | 22,594,370 | 7.60 seconds |
| XML | 33,974,756 | 8.36 seconds |

One sequential run per format on Windows / Ryzen 5 PRO 8540U / Node 24.19.0. Post-run heap snapshots ranged from 217 to 409 MB; they are not peak-memory measurements. See bulk-benchmark.json. A separate Chrome 153 browser run uploaded, previewed, validated, scored and rendered the JSON fixture in 10.21 seconds (bulk-browser.json). Results vary by computer and data shape. Low-memory browsers can still fail below the hard limits.

Regenerate and benchmark from the project root (Python and installed development dependencies required):

```sh
python3 pipeline/generate.py --seed 884 --scenarios 2500 --output work/bulk-review
node scripts/bulk-benchmark.mjs work/bulk-review
TRACE_BULK_FILE="$PWD/work/bulk-review.json" npm run test:e2e
```

Start `python3 serve.py` in another terminal before browser tests. On Windows use `python` and set `$env:TRACE_BULK_FILE` in PowerShell. The generated benchmark files are not needed to run the application.
