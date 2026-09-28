# Dataset, schema and import guide

## Encodings

JSON is an array of flat records (or `{ "records": [...] }`). XML is `<records><record>...</record></records>`; field elements contain scalar text or JSON-encoded arrays. DTD and ENTITY declarations are rejected. CSV has a header; **array fields contain JSON arrays inside standard CSV quoted cells**, with embedded quotes doubled. Example cell: `"[""addressA"",""addressB""]"`. Use the generator/Python csv module rather than constructing CSV manually. UTF-8 is expected; a single source record contains transaction data and optionally one network observation. Repeated transactions across observation rows must agree.

## Field dictionary

| Field | Type / unit | Required and meaning |
|---|---|---|
| timestamp | ISO-8601 with `Z` or numeric offset | Required transaction event timestamp, normalized to UTC. Not inferred from observation time. |
| txid | 64 hexadecimal characters | Required unique transaction identifier; normalized lowercase. |
| input_addresses | JSON string array | Required when `inputs` absent; opaque nonempty IDs, ≤200 characters. |
| output_addresses | JSON string array | Required when `outputs` absent. |
| input_amounts | JSON integer array, satoshis | Required with input address array, same length. |
| output_amounts | JSON integer array, satoshis | Required with output address array, same length; at least one output. |
| fees | nonnegative safe integer, satoshis | Optional; no fee is invented. Missing fee uses zero only in the model feature and reduces evidence quality. |
| script_type | string | Optional descriptive source field, otherwise `unknown`; not a model feature. |
| inputs | JSON object array | Preferred: `{address,amount,prev_txid?,prev_index?}`. For known outpoints supply both previous fields. |
| outputs | JSON object array | Preferred: `{address,amount,index}` with unique nonnegative indices. When only arrays exist, index is derived from array position. |
| funding_boundary | boolean | Optional explicit initial synthetic funding marker. No inputs and fee zero in generated boundaries. |
| observation_id | string ≤200 characters | Required to retain a network observation. Same ID and content deduplicates. |
| observation_timestamp | ISO-8601 with timezone | Required with observation ID; kept distinct from transaction event time. |
| src_ip / dst_ip | IPv4 or IPv6 string | Required for a complete network observation; parsed with ipaddr.js. |
| src_port / dst_port | integer 1–65535 | Required for a complete observation. Port zero is rejected for this metadata schema. |
| observer_id | string | Optional sensor provenance. |
| geo_country | string | Optional supplied metadata; demo uses `ZZ` with simulated provenance, never a real lookup claim. |
| asn | nonnegative safe integer | Optional supplied metadata; demo uses private ASN 64512. |
| geo_provenance | string | Optional; default `supplied, unverified`; generated values are `simulated`. |
| synthetic | boolean | True only for synthetic rows. Dataset badge appears only if every retained transaction is marked synthetic. |

If both arrays and structured objects are provided, they must agree. Amount strings in CSV/XML are parsed to integers. Booleans/empty values/negative/fractional/unsafe values cannot represent satoshis. Transaction sums above JavaScript's safe integer are rejected; dataset totals use BigInt. BTC decimal arithmetic is never used. Address IDs are not checked against Bitcoin address checksums or supported scripts.

## Partial analysis and validation

Transaction timestamp, TXID and amounts/addresses are the minimum structure. Known input amounts must cover outputs; with known fees they must exactly balance. Missing outpoints retain participation but disable the corresponding spend links. Missing referenced parent transactions warn and disable those links. No-input rows without a declared boundary warn that accounting is unavailable. A missing fee is not derived, since partial data may be incomplete.

Invalid transaction rows are rejected. All records for conflicting TXIDs are excluded; invalid spend transactions and their descendants are excluded. Competing spends reject the later transaction in deterministic timestamp/TXID order; this is data validation, not consensus adjudication. Parent output amount/address/index and strict chronology must match. Repeated source observations do not inflate transaction count/value; duplicate observation IDs warn, conflicting observations are excluded on the conflicting row. Invalid or incomplete IP/port/time excludes that observation while preserving a valid transaction. An observation preceding transaction time warns about clock semantics.

Import displays a five-row preview, column mapping, unique valid transactions, rejected source rows and warnings. The first 100 quality findings are displayed; the JSON report contains all with one-based data-row numbers (CSV header excluded). Record limit: 50,000; file limit: 50 MiB UTF-8. Cancellation terminates the worker; reset discards the staged file. No artificial data is inserted to fill missing evidence.

## Synthetic scenarios and boundaries

Generator: `python pipeline/generate.py --seed 42 --scenarios 35 --output public/data/sample`.

Each independent scenario starts with a funding transaction with explicit `funding_boundary=true` and previously unspent outputs. Those are an external initial funding boundary, not mined block/coinbase simulation. Subsequent inputs reference an existing output exactly once; inputs equal outputs plus fee. Timestamps increase strictly inside each scenario. Synthetic IDs are SHA-256 values and `synthetic_...` address aliases, not spendable Bitcoin keys. IPs are documentation networks 192.0.2.0/24 and 198.51.100.0/24.

Seven scenario families cycle through ordinary payment/change, legitimate batches, legitimate high value, consolidation, rapid bursts, repeated 95%-share forwarding/peeling, and equal-output CoinJoin-like collaboration. Each has three spending steps, or six for burst/peeling. Ordinary/batch/consolidation cases are legitimate lookalikes for simple risk assumptions. CoinJoin-like privacy structures are not wrongdoing. Some scenarios have no peer observations; others have one to three per transaction. The malformed fixture is a separate file and never enters training.

| Split | Seed | Independent scenarios | Unique transactions | Source records |
|---|---:|---:|---:|---:|
| Training | 1201 | 210 | 1020 | 1916 |
| Calibration | 2402 | 105 | 510 | 954 |
| Evaluation | 3603 | 105 | 510 | 967 |
| Reviewer sample | 42 | 35 | 170 | 306 |

Seeds change values, timing, addresses and batch sizes. No connected scenario crosses split boundaries. Labels live in separate `.labels.json` files, never in transaction features. Target=1 denotes non-funding burst/peeling transactions. Model fitting and calibration select target=0 as a reference population; evaluation includes all 510 transactions. Scenario labels are used for reference selection and evaluation, not as features. This synthetic design is narrow and cannot establish real-world generalization.
