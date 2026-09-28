# Bulk metadata verification

CSV, JSON and XML accept up to **100 MiB and 100,000 source records per file** (previously 50 MiB / 50,000). Preview, validation, chronological graph representation and scoring run in a Web Worker. Cancel/reset terminates the worker. The importer remains bounded and in-memory, not streaming. Graphs render at most 180 blocks.

Version 2 uses an observation index rather than scanning every observation for each transaction. This removes the previous transaction × observation scan during analysis. The larger model has 128 trees.

Fixture: seed 9884, 5,000 independent scenarios, **58,555 source records, 30,653 transactions, 55,747 observations**, zero rejected rows. All three formats produced identical transaction scores. These files exceed both previous limits; the new maximum is a guardrail, not a universal capacity guarantee.

| Format | Bytes | Parse + validation + analysis | Post-run heap |
|---|---:|---:|---:|
| JSON | 71,115,668 | 4.05 s | 496.9 MB |
| CSV | 56,361,769 | 5.31 s | 778.3 MB |
| XML | 85,069,367 | 11.47 s | 696.3 MB |

Single sequential run per format, Node v24.19.0 on Windows / Ryzen 5 PRO 8540U. Memory is a post-run snapshot, not peak, and includes runtime/GC effects. Node timings exclude browser transfer and rendering. A separate Chrome 153.0.8010.53 workflow uploaded, previewed, validated, scored and rendered the 71,115,668-byte JSON fixture in **14.71 seconds**. See the two JSON reports beside this document.

Low-memory browsers may fail below the limit. The full 100,000-record ceiling is not claimed as benchmarked. Geo-IP runs in a separate worker and loading its tables consumes additional memory; clear it before processing a large case on a constrained computer. Case exports can exceed their source-file size and have a separate 100 MiB re-import limit.

Regenerate and verify (Linux, with dependencies installed):

```sh
python3 pipeline/generate.py --seed 9884 --scenarios 5000 --output generated/bulk-v2
node scripts/bulk-benchmark.mjs generated/bulk-v2
# In another terminal: python3 serve.py
TRACE_BULK_FILE="$PWD/generated/bulk-v2.json" TRACE_BULK_TRANSACTIONS=30653 npm run test:e2e
```

On PowerShell use `$env:TRACE_BULK_FILE` and `$env:TRACE_BULK_TRANSACTIONS`. The fixture is generated locally and excluded from Git. Native Linux memory/performance and hosted-build end-to-end testing remain outstanding.
