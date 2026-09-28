import { AnalystSummary } from "./AnalystSummary";
import { MAX_BYTES } from "./ingest";
import { registerNavigation } from "./webmcp";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { Analysis, Dataset, Model, Alert } from "./types";
import { Graph } from "./Graph";
import {
  caseFile,
  download,
  evidenceCSV,
  readCase,
  storage,
  limitations,
  type Review,
} from "./cases";
import { lookupGeo, validateGeo, type GeoRow } from "./geo";
import "./style.css";
import { CaseOverview, GettingStarted } from "./Dashboard";
import {
  TransactionTimeline,
  TransactionConnections,
  LinuxSetup,
} from "./TransactionTools";
const pages = [
  "Overview",
  "Import data",
  "Analyst workspace",
  "Graph explorer",
  "Investigations",
  "Model and evaluation",
  "Help and methodology",
];
const expected = [
  "timestamp",
  "txid",
  "input_addresses",
  "output_addresses",
  "input_amounts",
  "output_amounts",
  "inputs",
  "outputs",
  "fees",
  "script_type",
  "observation_id",
  "observation_timestamp",
  "src_ip",
  "dst_ip",
  "src_port",
  "dst_port",
  "observer_id",
  "geo_country",
  "asn",
];
const short = (s: string) => s.slice(0, 12) + "…";
function App() {
  const [themeChoice, setThemeChoice] = useState(() => {
    try {
      const v = localStorage.getItem("trace-theme");
      return v === "light" || v === "dark" ? v : "system";
    } catch {
      return "system";
    }
  });
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const theme =
    themeChoice === "system" ? (systemDark ? "dark" : "light") : themeChoice;
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const changed = () => setSystemDark(media.matches);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("trace-theme", themeChoice);
    } catch {}
  }, [theme, themeChoice]);
  const [page, setPage] = useState("Overview"),
    [model, setModel] = useState<Model | null>(null),
    [evaluation, setEvaluation] = useState<any>(null),
    [dataset, setDataset] = useState<Dataset | null>(null),
    [analysis, setAnalysis] = useState<Analysis | null>(null),
    [reviews, setReviews] = useState<Record<string, Review>>({}),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [progressText, setProgressText] = useState(""),
    [preview, setPreview] = useState<any>(null),
    [raw, setRaw] = useState<{
      text: string;
      format: string;
      name: string;
    } | null>(null),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("all"),
    [status, setStatus] = useState("all"),
    [sort, setSort] = useState("score"),
    [selected, setSelected] = useState<Alert | null>(null),
    [graphFocus, setGraphFocus] = useState(""),
    [seed, setSeed] = useState(""),
    [provenance, setProvenance] = useState(""),
    [geo, setGeo] = useState<GeoRow[]>([]),
    [geoIp, setGeoIp] = useState("");
  const worker = useRef<Worker | null>(null),
    pending = useRef(
      new Map<
        number,
        { resolve: (r: any) => void; reject: (e: any) => void }
      >(),
    ),
    seq = useRef(0);
  const initWorker = () => {
    const w = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    w.onmessage = (e) => {
      const r = e.data;
      if (r.progress != null) {
        setProgress(r.progress);
        setProgressText(r.message);
        return;
      }
      const p = pending.current.get(r.id);
      if (p) {
        pending.current.delete(r.id);
        r.error ? p.reject(Error(r.error)) : p.resolve(r.result);
      }
    };
    w.onerror = (e) => {
      for (const p of pending.current.values())
        p.reject(Error(e.message || "Analysis worker failed"));
      pending.current.clear();
    };
    worker.current = w;
  };
  const rpc = (action: string, args: any) =>
    new Promise<any>((resolve, reject) => {
      const id = ++seq.current;
      pending.current.set(id, { resolve, reject });
      worker.current!.postMessage({ id, action, ...args });
    });
  useEffect(() => {
    initWorker();
    Promise.all([
      fetch("./model/isolation-forest.json").then((r) => {
        if (!r.ok) throw Error("Model artifact unavailable");
        return r.json();
      }),
      fetch("./model/evaluation.json").then((r) => {
        if (!r.ok) throw Error("Evaluation artifact unavailable");
        return r.json();
      }),
    ])
      .then(([m, e]) => {
        setModel(m);
        setEvaluation(e);
      })
      .catch((e) =>
        setError("Cannot load required model assets: " + e.message),
      );
    return () => worker.current?.terminate();
  }, []);
  async function task(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setProgress(0);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  function cancel() {
    worker.current?.terminate();
    for (const p of pending.current.values())
      p.reject(Error("Cancelled. Previous completed analysis retained."));
    pending.current.clear();
    initWorker();
    setBusy(false);
    setPreview(null);
    setRaw(null);
    setProgress(0);
  }
  async function run(d = dataset, s = seed, p = provenance) {
    if (!d || !model) throw Error("Load valid data and model first");
    const a = await rpc("analyze", {
      dataset: d,
      model,
      seed: s,
      provenance: p,
    });
    setAnalysis(a);
    setSelected(null);
    setMessage(
      "Analysis complete. " +
        a.dataset.transactions.length +
        " unique transactions scored locally.",
    );
  }
  const sample = () =>
    task(async () => {
      const r = await fetch("./data/sample.json");
      if (!r.ok) throw Error("Sample dataset unavailable");
      const d = await rpc("ingest", { text: await r.text(), format: "json" });
      setDataset(d);
      setReviews({});
      setSeed("");
      setProvenance("");
      await run(d, "", "");
      setPage("Overview");
    });
  async function upload(file: File) {
    await task(async () => {
      setPreview(null);
      setRaw(null);
      if (file.size > MAX_BYTES) throw Error("File exceeds 50 MiB limit");
      const text = await file.text(),
        format = file.name.split(".").pop()!.toLowerCase();
      const p = await rpc("preview", { text, format });
      setRaw({ text, format, name: file.name });
      setPreview(p);
      setMapping({});
      setPage("Import data");
      setMessage("Preview ready. Review mapping, then validate.");
    });
  }
  async function importCase(file: File) {
    await task(async () => {
      if (file.size > 50 * 1024 * 1024) throw Error("Case exceeds 50 MiB");
      const c = readCase(await file.text());
      if (c.analysis.modelVersion !== model?.version)
        throw Error("Case model version differs from bundled model");
      const rows = c.analysis.dataset.transactions.map((t) => ({
        txid: t.txid,
        timestamp: t.timestamp,
        inputs: t.inputs,
        outputs: t.outputs,
        fees: t.fees,
        script_type: t.script_type,
        funding_boundary: t.funding_boundary,
        synthetic: t.synthetic,
      }));
      const obs = c.analysis.dataset.observations;
      const expanded = rows.flatMap((r) => {
        const matched = obs.filter((o) => o.txid === r.txid);
        return matched.length
          ? matched.map((o) => ({
              ...r,
              observation_id: o.id,
              observation_timestamp: o.timestamp,
              src_ip: o.src_ip,
              dst_ip: o.dst_ip,
              src_port: o.src_port,
              dst_port: o.dst_port,
              observer_id: o.observer_id,
              geo_country: o.geo_country,
              asn: o.asn,
              geo_provenance: o.geo_provenance,
            }))
          : [r];
      });
      const d: Dataset = await rpc("ingest", {
        text: JSON.stringify(expanded),
        format: "json",
      });
      if (d.rejected) throw Error("Case contains invalid transaction data");
      d.hash = c.analysis.dataset.hash;
      // Preserve exported source evidence after validating normalized records.
      // Its original-file identifier remains a provenance claim, not a signature.
      for (const t of d.transactions) {
        const original = c.analysis.dataset.transactions.find(
          (o) => o.txid === t.txid,
        )!;
        if (original.source && typeof original.source === "object")
          t.source = original.source;
        if (original.provenance && typeof original.provenance === "object")
          t.provenance = original.provenance;
      }
      setDataset(d);
      setSeed(c.analysis.settings.seed);
      setProvenance(c.analysis.settings.provenance);
      setReviews(c.reviews);
      await run(d, c.analysis.settings.seed, c.analysis.settings.provenance);
      setMessage(
        "Case imported and scores regenerated. Original dataset identifier preserved from case.",
      );
    });
  }
  const graph = (id: string) => {
    setGraphFocus("t:" + id);
    setPage("Graph explorer");
  };
  const updateReview = (txid: string, patch: Partial<Review>) =>
    setReviews((v) => ({
      ...v,
      [txid]: { ...(v[txid] || { status: "new", note: "" }), ...patch },
    }));
  const alerts =
    analysis?.alerts
      .filter(
        (a) =>
          (category === "all" ||
            (category === "leads" && a.category !== "Reference transaction") ||
            a.category.includes(category)) &&
          (status === "all" || (reviews[a.txid]?.status || "new") === status) &&
          (!query ||
            a.txid.includes(query) ||
            a.category.toLowerCase().includes(query.toLowerCase()) ||
            analysis?.dataset.transactions.some(
              (t) =>
                t.txid === a.txid &&
                [...t.inputs, ...t.outputs].some((io) =>
                  io.address.includes(query),
                ),
            ) ||
            analysis?.dataset.observations.some(
              (o) =>
                o.txid === a.txid &&
                (o.src_ip.includes(query) || o.dst_ip.includes(query)),
            )),
      )
      .sort((a, b) =>
        sort === "time"
          ? b.timestamp.localeCompare(a.timestamp)
          : sort === "quality"
            ? b.quality - a.quality
            : b.score - a.score,
      ) || [];
  const nav = (p: string) => {
    setPage(p);
    setError("");
    setMessage("");
  };
  useEffect(() => registerNavigation(setPage, pages), []);
  const geoResult = lookupGeo(geoIp, geo);
  return (
    <div className="app">
      <header className="topbar">
        <div className="wordmark">
          Trace<span>Ledger</span>
        </div>
        <nav aria-label="Main navigation">
          {pages.map((p) => (
            <button
              key={p}
              className={page === p ? "active" : ""}
              aria-current={page === p ? "page" : undefined}
              onClick={() => nav(p)}
            >
              {p === "Help and methodology"
                ? "Help"
                : p === "Model and evaluation"
                  ? "Model"
                  : p}
            </button>
          ))}
        </nav>
        <details className="theme-menu" onKeyDown={(e) => { if (e.key === "Escape") e.currentTarget.open = false; }}>
          <summary className="theme-switch">Mode <span>▾</span></summary>
          <div className="theme-options" aria-label="Color theme">
            {["light", "dark", "system"].map(choice => <button key={choice} aria-pressed={themeChoice === choice} onClick={e => { setThemeChoice(choice); e.currentTarget.closest("details")?.removeAttribute("open"); }}>
              {choice[0].toUpperCase() + choice.slice(1)} {themeChoice === choice ? "✓" : ""}
            </button>)}
          </div>
        </details>
      </header>
      <main>
        <header>
          <div>
            <h1>
              {page === "Overview"
                ? "AI Powered Bitcoin Transaction Investigation"
                : page === "Help and methodology"
                  ? "Help"
                  : page}
            </h1>
            {page === "Overview" && (
              <p className="overview-description">
                Making sense of Bitcoin's maze of transactions,one connection at
                a time
              </p>
            )}
          </div>
        </header>
        <div className="notice">
          Investigative leads only. Relay IPs do not establish wallet ownership.
        </div>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {message && (
          <div className="success" role="status">
            {message}
          </div>
        )}
        {busy && (
          <div className="panel progress">
            <div>
              {progressText || "Preparing…"}{" "}
              <button onClick={cancel}>Cancel / reset import</button>
            </div>
            <progress max="100" value={progress} />
          </div>
        )}
        {page === "Overview" && (
          <>
            <section className={`start panel ${analysis ? "loaded" : ""}`}>
              <div>
                <h2>Investigation files</h2>

                <div className="toolbar">
                  <button
                    className="primary"
                    disabled={busy || !model}
                    onClick={sample}
                  >
                    Explore sample investigation
                  </button>
                  <button onClick={() => nav("Import data")}>
                    Upload dataset
                  </button>
                </div>
              </div>
              <div className="sample-files">
                <h3>Download sample files</h3>

                <div className="toolbar">
                  {["csv", "json", "xml"].map((f) => (
                    <a key={f} href={"./data/sample." + f} download>
                      ↓ {f.toUpperCase()}
                    </a>
                  ))}
                </div>
                <small>
                  170 transactions · 284 relay observations · synthetic
                </small>
              </div>
            </section>
            {analysis ? (
              <>
                <div className="metrics">
                  <Metric
                    label="Unique transactions"
                    value={analysis.dataset.transactions.length}
                  />
                  <Metric
                    label="Network observations"
                    value={analysis.dataset.observations.length}
                  />
                  <Metric
                    label="ML anomaly leads"
                    value={
                      analysis.alerts.filter(
                        (a) => a.score >= analysis.settings.threshold,
                      ).length
                    }
                  />
                  <Metric
                    label="Analysis time"
                    value={analysis.elapsedMs.toFixed(1) + " ms"}
                  />
                </div>
                <CaseOverview
                  analysis={analysis}
                  reviews={reviews}
                  onSelect={(a) => {
                    setSelected(a);
                    nav("Analyst workspace");
                  }}
                  onGraph={(id) => {
                    setGraphFocus(id);
                    nav("Graph explorer");
                  }}
                />
                <TransactionTimeline analysis={analysis} />
                <div className="two-col">
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Anomaly distribution</h2>
                      <span className="muted">Calibration percentile</span>
                    </div>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart
                        data={Array.from({ length: 10 }, (_, i) => ({
                          range: i * 10 + "–" + (i + 1) * 10,
                          count: analysis.alerts.filter(
                            (a) =>
                              a.percentile >= i * 10 &&
                              (i === 9
                                ? a.percentile <= 100
                                : a.percentile < (i + 1) * 10),
                          ).length,
                        }))}
                      >
                        <defs>
                          <linearGradient
                            id="anomaly-fill"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop offset="0%" stopColor="#3674fa" />
                            <stop offset="100%" stopColor="#dce9ff" />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          vertical={false}
                          stroke="#e9edf2"
                          strokeDasharray="3 4"
                        />
                        <XAxis
                          dataKey="range"
                          fontSize={12}
                          axisLine={false}
                          tickLine={false}
                          tickMargin={12}
                        />
                        <YAxis
                          allowDecimals={false}
                          axisLine={false}
                          tickLine={false}
                          fontSize={12}
                          width={32}
                        />
                        <Tooltip
                          cursor={{ fill: "#eef3fb" }}
                          contentStyle={{
                            borderRadius: 12,
                            border: "1px solid #e1e6ee",
                            fontFamily: "Arial, sans-serif",
                          }}
                        />
                        <Bar
                          isAnimationActive={false}
                          dataKey="count"
                          fill="url(#anomaly-fill)"
                          radius={[6, 6, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                    <p className="muted">
                      Calibration percentile · higher = more unusual
                    </p>
                  </section>
                  <section className="panel volume-panel">
                    <div className="panel-heading">
                      <h2>Transaction volume</h2>
                      <small>1 bitcoin = 100,000,000 satoshis</small>
                    </div>
                    <div className="volume-number">
                      {BigInt(analysis.totalOutputSats).toLocaleString()}
                      <span>satoshis</span>
                    </div>
                    <dl>
                      <dt>Validation warnings</dt>
                      <dd>
                        {
                          analysis.dataset.issues.filter(
                            (i) => i.severity === "warning",
                          ).length
                        }
                      </dd>
                      <dt>Rejected source rows</dt>
                      <dd>{analysis.dataset.rejected}</dd>
                      <dt>Inferred address groups</dt>
                      <dd>{analysis.clusters.length}</dd>

                      <dt>Known fees (satoshis)</dt>
                      <dd>{analysis.totalFeeSats}</dd>
                    </dl>
                    <p className="muted">
                      Gross output value; includes funding and repeat transfers.
                    </p>
                    <button onClick={() => nav("Import data")}>
                      Inspect data quality
                    </button>
                  </section>
                </div>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Flagged transactions & evidence</h2>
                    <button onClick={() => nav("Analyst workspace")}>
                      Review all leads →
                    </button>
                  </div>
                  <AlertTable
                    rows={analysis.alerts
                      .filter((a) => a.category !== "Reference transaction")
                      .slice(0, 5)}
                    reviews={reviews}
                    onSelect={(a) => {
                      setSelected(a);
                      nav("Analyst workspace");
                    }}
                  />
                </section>
              </>
            ) : (
              <GettingStarted navigate={nav} />
            )}
          </>
        )}
        {page === "Import data" && (
          <>
            <section className="panel">
              <h2>Import transaction & network records</h2>
              <p>
                CSV, JSON or XML · maximum 50 MiB / 50,000 source records. ISO
                timestamps require timezones. Amounts are integer satoshis.
              </p>
              <label className="upload">
                Choose dataset
                <input
                  aria-label="Choose dataset"
                  disabled={busy}
                  type="file"
                  accept=".csv,.json,.xml"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f);
                    e.target.value = "";
                  }}
                />
              </label>
              <button
                disabled={busy}
                onClick={() => {
                  setPreview(null);
                  setRaw(null);
                  setMapping({});
                  setMessage("Import reset; completed analysis retained.");
                }}
              >
                Reset import
              </button>
            </section>
            {preview && (
              <section className="panel">
                <h2>Preview: {raw?.name}</h2>
                <p>
                  {preview.count} source records. First five shown. Array fields
                  contain JSON arrays in every format.
                </p>
                <details open>
                  <summary>Column mapping</summary>
                  <div className="mapping">
                    {expected.map((k) => (
                      <label key={k}>
                        {k}
                        <select
                          value={
                            mapping[k] ?? (preview.columns.includes(k) ? k : "")
                          }
                          onChange={(e) =>
                            setMapping({ ...mapping, [k]: e.target.value })
                          }
                        >
                          <option value="">Not mapped</option>
                          {preview.columns.map((c: string) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </details>
                <pre>{JSON.stringify(preview.rows, null, 2)}</pre>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    task(async () => {
                      const d = await rpc("ingest", {
                        text: raw!.text,
                        format: raw!.format,
                        mapping,
                      });
                      setDataset(d);
                      setAnalysis(null);
                      setReviews({});
                      setSelected(null);
                      setMessage(
                        "Validation complete. " +
                          d.transactions.length +
                          " unique valid transactions.",
                      );
                    })
                  }
                >
                  Validate mapped data
                </button>
              </section>
            )}
            {dataset && (
              <section className="panel">
                <h2>Validation results</h2>
                <p className="analysis-prompt">
                  These checks confirm file quality only. Click{" "}
                  <strong>Run analysis</strong> below to generate model scores
                  and transaction connections.
                </p>
                <div className="metrics">
                  <Metric
                    label="Valid unique transactions"
                    value={dataset.transactions.length}
                  />
                  <Metric
                    label="Rejected source rows"
                    value={dataset.rejected}
                  />
                  <Metric
                    label="Warnings"
                    value={
                      dataset.issues.filter((i) => i.severity === "warning")
                        .length
                    }
                  />
                  <Metric
                    label="Unique observations"
                    value={dataset.observations.length}
                  />
                </div>
                <div className="toolbar">
                  <button
                    className="primary"
                    disabled={busy || !dataset.transactions.length || !model}
                    onClick={() =>
                      task(async () => {
                        await run();
                        setPage("Analyst workspace");
                      })
                    }
                  >
                    Run analysis
                  </button>
                  <button
                    onClick={() =>
                      download("validation-report.json", {
                        dataset: dataset.hash,
                        rows: dataset.rows,
                        rejected: dataset.rejected,
                        issues: dataset.issues,
                      })
                    }
                  >
                    Download validation report
                  </button>
                </div>
                <p>
                  Missing network observations disable relay correlation for
                  those transactions. Missing references disable corresponding
                  spending links and complete tracing. Missing fees reduce
                  evidence quality.
                </p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Source row</th>
                        <th>Severity</th>
                        <th>Field</th>
                        <th>Finding</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dataset.issues.slice(0, 100).map((i, n) => (
                        <tr key={n}>
                          <td>{i.row}</td>
                          <td>{i.severity}</td>
                          <td>{i.field}</td>
                          <td>{i.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <small>
                  Showing up to 100 findings; full report is downloadable.
                </small>
              </section>
            )}
          </>
        )}
        {page === "Analyst workspace" &&
          (analysis ? (
            <>
              <section className="panel entity-explorer">
                <h2>Entity explorer</h2>
                <p>
                  Select a transaction to review its model score, connections
                  and analyst summary. Scores rank unusual activity; they are
                  not crime probabilities.
                </p>
                <div className="toolbar">
                  <input
                    aria-label="Search alerts"
                    placeholder="Search transaction, address, IP or category"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <select
                    aria-label="Alert category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    {[
                      "leads",
                      "all",
                      "ML anomaly",
                      "Peeling-like",
                      "CoinJoin-like",
                    ].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                  <select
                    aria-label="Review status filter"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    {[
                      "all",
                      "new",
                      "acknowledged",
                      "reviewed",
                      "dismissed",
                    ].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                  <select
                    aria-label="Sort alerts"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="score">Highest anomaly</option>
                    <option value="time">Latest transaction</option>
                    <option value="quality">Evidence quality</option>
                  </select>
                </div>
                <p>
                  {alerts.length} matching transactions · Showing first 100.
                  Percentiles use the fixed calibration reference.
                </p>
                <AlertTable
                  rows={alerts.slice(0, 100)}
                  reviews={reviews}
                  onSelect={(a) => {
                    setSelected(a);
                    requestAnimationFrame(() =>
                      document
                        .getElementById("alert-detail")
                        ?.scrollIntoView({ block: "start" }),
                    );
                  }}
                />
                {!alerts.length && <p>No transactions match these filters.</p>}
              </section>
              {selected && (
                <section className="panel" id="alert-detail">
                  <div className="panel-heading">
                    <h2>Supporting observations</h2>
                    <button onClick={() => graph(selected.txid)}>
                      Inspect in graph
                    </button>
                  </div>
                  <code>{selected.txid}</code>
                  <p>
                    {selected.category} · {selected.timestamp}
                  </p>
                  <div className="metrics">
                    <Metric
                      label="Anomaly score"
                      value={selected.score.toFixed(6)}
                    />
                    <Metric
                      label="Calibration percentile"
                      value={selected.percentile.toFixed(1)}
                    />
                    <Metric
                      label="Evidence quality"
                      value={selected.quality.toFixed(0) + "/100"}
                    />
                  </div>
                  <p>
                    Evidence quality measures field availability; it is not
                    statistical confidence. Feature comparisons support review
                    and are not model-attribution explanations.
                  </p>
                  <ul>
                    {selected.support.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Feature</th>
                          <th>Observed</th>
                          <th>Reference median</th>
                          <th>Reference 5–95%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {model?.features.map((f, i) => (
                          <tr key={f}>
                            <td>{f}</td>
                            <td>{selected.features[i].toFixed(3)}</td>
                            <td>{model.reference[f].median.toFixed(3)}</td>
                            <td>
                              {model.reference[f].p05.toFixed(3)} –{" "}
                              {model.reference[f].p95.toFixed(3)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <TransactionConnections
                    analysis={analysis}
                    txid={selected.txid}
                    onSelect={setSelected}
                  />
                  <AnalystSummary alert={selected} analysis={analysis} />
                  <div className="review">
                    <label>
                      Review status
                      <select
                        aria-label="Review status"
                        value={reviews[selected.txid]?.status || "new"}
                        onChange={(e) =>
                          updateReview(selected.txid, {
                            status: e.target.value as Review["status"],
                          })
                        }
                      >
                        {["new", "acknowledged", "reviewed", "dismissed"].map(
                          (s) => (
                            <option key={s}>{s}</option>
                          ),
                        )}
                      </select>
                    </label>
                    <label>
                      Analyst notes
                      <textarea
                        aria-label="Analyst notes"
                        placeholder="Record your findings, evidence gaps and next steps for this transaction."
                        value={reviews[selected.txid]?.note || ""}
                        onChange={(e) =>
                          updateReview(selected.txid, { note: e.target.value })
                        }
                      />
                    </label>
                  </div>
                  <details>
                    <summary>Source records and provenance</summary>
                    <pre>
                      {JSON.stringify(
                        {
                          transaction: analysis.dataset.transactions.find(
                            (t) => t.txid === selected.txid,
                          ),
                          observations: analysis.dataset.observations.filter(
                            (o) => o.txid === selected.txid,
                          ),
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </section>
              )}
            </>
          ) : (
            <Empty onSample={sample} />
          ))}
        {page === "Graph explorer" &&
          (analysis ? (
            <section className="panel">
              <h2>Follow connections</h2>
              <Graph
                theme={theme}
                onReview={(id) => {
                  const a = analysis.alerts.find((a) => a.txid === id);
                  if (a) {
                    setSelected(a);
                    nav("Analyst workspace");
                  }
                }}
                analysis={analysis}
                initialFocus={graphFocus}
                rpc={rpc}
                geo={geo}
              />
            </section>
          ) : (
            <Empty onSample={sample} />
          ))}
        {page === "Investigations" && (
          <>
            <section className="panel">
              <h2>Save or resume a case</h2>
              <p>
                Saved in this browser only. Clearing browser storage deletes
                saved cases; export a backup first.
              </p>
              <div className="toolbar">
                <button
                  disabled={!analysis}
                  onClick={() =>
                    task(async () => {
                      await storage("save", caseFile(analysis!, reviews));
                      setMessage("Case saved in this browser.");
                    })
                  }
                >
                  Save case locally
                </button>
                <button
                  onClick={() =>
                    task(async () => {
                      const c = await storage("load");
                      if (!c) throw Error("No saved case in this browser");
                      setAnalysis(c.analysis);
                      setDataset(c.analysis.dataset);
                      setReviews(c.reviews);
                      setSeed(c.analysis.settings.seed);
                      setProvenance(c.analysis.settings.provenance);
                      setMessage(
                        "Saved case restored. Scores are from the saved analysis.",
                      );
                    })
                  }
                >
                  Restore saved case
                </button>
                <label className="file-button">
                  Import case
                  <input
                    aria-label="Import case"
                    type="file"
                    accept=".json"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void importCase(f);
                      e.target.value = "";
                    }}
                  />
                </label>
                <button
                  onClick={() =>
                    task(async () => {
                      setAnalysis(null);
                      setDataset(null);
                      setReviews({});
                      setSelected(null);
                      setPreview(null);
                      setRaw(null);
                      setGeo([]);
                      setSeed("");
                      setProvenance("");
                      try {
                        await storage("clear");
                        setMessage("Working data and saved case cleared.");
                      } catch {
                        throw Error(
                          "Working data cleared; browser storage unavailable, saved case removal could not be confirmed.",
                        );
                      }
                    })
                  }
                >
                  Clear all local data
                </button>
              </div>
              {analysis && (
                <details>
                  <summary>Dataset details</summary>
                  <p>
                    {analysis.dataset.synthetic
                      ? "Synthetic demonstration data"
                      : "Uploaded data"}
                  </p>
                  <code>{analysis.dataset.hash}</code>
                  <p>Model: {analysis.modelVersion}</p>
                </details>
              )}
            </section>
            {analysis && (
              <>
                <section className="panel">
                  <h2>Export findings</h2>
                  <div className="toolbar">
                    <button
                      onClick={() =>
                        download(
                          "trace-ledger-case.json",
                          caseFile(analysis, reviews),
                        )
                      }
                    >
                      Export case / evidence JSON
                    </button>
                    <button
                      onClick={() =>
                        download(
                          "trace-ledger-evidence.csv",
                          evidenceCSV(analysis, reviews),
                          "text/csv",
                        )
                      }
                    >
                      Export evidence CSV
                    </button>
                    <button onClick={() => window.print()}>Print report</button>
                  </div>
                  <p>
                    Includes dataset hash, model version, settings and review
                    notes.
                  </p>
                </section>
                <details className="panel optional-tool">
                  <summary>Trace from an address</summary>
                  <p>
                    Enter an address to follow up to 3 outgoing transaction
                    links. Exposure starts at 100 and halves at each step. It
                    shows a connection, not wrongdoing or an exact amount
                    transferred.
                  </p>
                  <label>
                    Seed address
                    <input
                      aria-label="Seed address"
                      value={seed}
                      onChange={(e) => setSeed(e.target.value)}
                    />
                  </label>
                  <label>
                    Seed provenance
                    <input
                      aria-label="Seed provenance"
                      value={provenance}
                      onChange={(e) => setProvenance(e.target.value)}
                      placeholder="Source, context and date"
                    />
                  </label>
                  <div className="toolbar">
                    <button
                      disabled={busy}
                      onClick={() =>
                        task(async () => {
                          await run();
                          setMessage(
                            "Exposure recalculated from supplied seed.",
                          );
                        })
                      }
                    >
                      Calculate exposure
                    </button>
                    {analysis.dataset.synthetic && (
                      <button
                        onClick={() => {
                          setSeed(
                            analysis.dataset.transactions.find(
                              (t) =>
                                t.inputs.length === 1 && t.outputs.length === 2,
                            )?.inputs[0].address || "",
                          );
                          setProvenance(
                            "Synthetic demonstration seed; no real-world allegation",
                          );
                        }}
                      >
                        Use synthetic seed
                      </button>
                    )}
                  </div>
                  <p>
                    {analysis.exposure.length} transactions reached. Exposure is
                    separate from anomaly.
                  </p>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Transaction</th>
                          <th>Exposure</th>
                          <th>Distance</th>
                          <th>Supporting path</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.exposure.map((e) => (
                          <tr key={e.txid}>
                            <td>
                              <button onClick={() => graph(e.txid)}>
                                {short(e.txid)}
                              </button>
                            </td>
                            <td>{e.score}</td>
                            <td>{e.distance}</td>
                            <td>
                              <details>
                                <summary>
                                  {e.path.length} transaction(s)
                                </summary>
                                <pre>{JSON.stringify(e, null, 2)}</pre>
                              </details>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
                <details className="panel optional-tool">
                  <summary>Related address groups</summary>
                  <p>
                    Common inputs suggest an association, not verified
                    ownership. Detected CoinJoin-like transactions are excluded
                    from merging; this safeguard is imperfect.
                  </p>
                  {analysis.clusters.slice(0, 30).map((c) => (
                    <details key={c.id}>
                      <summary>
                        {c.id} · {c.addresses.length} addresses
                      </summary>
                      <pre>{JSON.stringify(c, null, 2)}</pre>
                      <button
                        onClick={() => {
                          setGraphFocus(c.id);
                          setPage("Graph explorer");
                        }}
                      >
                        Open inferred group
                      </button>
                    </details>
                  ))}
                </details>
              </>
            )}
            <details className="panel optional-tool">
              <summary>Look up an IP location</summary>
              <p>
                Load a licensed local CIDR lookup table. IPv4 and IPv6
                longest-prefix matching are supported. Approximate location does
                not identify a person. No real Geo-IP data is bundled.
              </p>
              <input
                aria-label="Import Geo-IP"
                type="file"
                accept=".json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    void task(async () => {
                      if (f.size > 20 * 1024 * 1024)
                        throw Error("Geo-IP file exceeds 20 MiB");
                      setGeo(validateGeo(JSON.parse(await f.text())));
                      setMessage("Local Geo-IP table loaded.");
                    });
                }}
              />
              <label>
                IP lookup
                <input
                  aria-label="IP lookup"
                  value={geoIp}
                  onChange={(e) => setGeoIp(e.target.value)}
                />
              </label>
              <p>
                {geoResult
                  ? `${geoResult.country} · AS${geoResult.asn} · ${geoResult.source} · updated ${geoResult.updated}`
                  : "Geo-IP unavailable"}
              </p>
            </details>
          </>
        )}
        {page === "Model and evaluation" && (
          <>
            <section className="panel">
              <h2>How the model works</h2>
              <p>
                Isolation Forest finds transactions that differ from the
                training data.
              </p>
              <div className="explain-grid">
                <article>
                  <h3>1. Compare</h3>
                  <p>
                    Checks amounts, fees, input and output counts, and earlier
                    activity.
                  </p>
                </article>
                <article>
                  <h3>2. Rank</h3>
                  <p>A higher score means a more unusual transaction.</p>
                </article>
                <article>
                  <h3>3. Review</h3>
                  <p>
                    Use the source records to decide what needs further
                    investigation.
                  </p>
                </article>
              </div>
              <details>
                <summary>Training details and downloads</summary>
                <p>
                  Version {model?.version}. Trained in Python on synthetic
                  transactions; runs locally in your browser.
                </p>
                <p>
                  64 trees, 256 training samples per tree, random seed 1729.
                  Alert threshold: {model?.alert_threshold.toFixed(6)}.
                </p>
                <p>
                  Score = 2^(−mean adjusted path length / c(256)). Percentile is
                  the share of calibration scores at or below the transaction's
                  score.
                </p>
                <p>
                  Training, calibration and evaluation use separate scenarios
                  and seeds. Evaluation labels mark bursts and peeling patterns,
                  not crime.
                </p>
                <div className="toolbar">
                  <a href="./model/isolation-forest.json" download>
                    Download model
                  </a>
                  <a href="./model/feature-manifest.json" download>
                    Feature definitions
                  </a>
                  <a href="./model/reference-scores.json" download>
                    Reference scores
                  </a>
                  <a href="./model/evaluation.json" download>
                    Evaluation results
                  </a>
                </div>
              </details>
            </section>
            {evaluation && (
              <section className="panel">
                <h2>Test results</h2>
                <p>
                  {evaluation.datasets.evaluation.transactions} transactions ·
                  seed {evaluation.datasets.evaluation.seed} · K=
                  {evaluation.isolation_forest.k}
                </p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Method</th>
                        <th>Precision@K</th>
                        <th>Precision</th>
                        <th>Recall</th>
                        <th>False positives</th>
                      </tr>
                    </thead>
                    <tbody>
                      {["isolation_forest", "rule_baseline"].map((k) => (
                        <tr key={k}>
                          <td>
                            {k === "isolation_forest"
                              ? "Trained model"
                              : "Simple rules"}
                          </td>
                          <td>{evaluation[k].precision_at_k.toFixed(3)}</td>
                          <td>{evaluation[k].precision.toFixed(3)}</td>
                          <td>{evaluation[k].recall.toFixed(3)}</td>
                          <td>{evaluation[k].false_positives}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="evaluation-note">
                  The model misses most labelled patterns in this test. These
                  results do not measure real-world crime detection.
                </p>
                <details>
                  <summary>What these numbers mean</summary>
                  <ul>
                    <li>
                      Precision: how many flagged transactions matched the test
                      labels.
                    </li>
                    <li>Recall: how many labelled transactions were found.</li>
                    <li>
                      Precision@K: matches among the top-ranked K transactions.
                    </li>
                    <li>
                      False positives: flagged transactions without a target
                      label.
                    </li>
                  </ul>
                  <p>
                    The simple rules flag 3 or more earlier address uses within
                    an hour, or a largest-output share of at least 94%.
                  </p>
                </details>
                <details>
                  <summary>Evaluation environment and counts</summary>
                  <pre>{JSON.stringify(evaluation, null, 2)}</pre>
                </details>
              </section>
            )}
            <section className="panel">
              <h2>Reading an alert</h2>
              <div className="explain-grid">
                <article>
                  <h3>Anomaly score</h3>
                  <p>
                    How unusual the transaction looks. It is not a probability
                    of crime.
                  </p>
                </article>
                <article>
                  <h3>Evidence quality</h3>
                  <p>How complete the available records are, from 0 to 100.</p>
                </article>
                <article>
                  <h3>Supporting observations</h3>
                  <p>
                    Values compared with typical training data. They do not
                    prove why the model gave its score.
                  </p>
                </article>
              </div>
              <details>
                <summary>How evidence quality is calculated</summary>
                <ul>
                  <li>25 points for valid transaction structure.</li>
                  <li>25 points for a known fee.</li>
                  <li>
                    Up to 25 points for complete input references; funding
                    boundaries receive full credit.
                  </li>
                  <li>25 points for at least one valid network observation.</li>
                </ul>
                <p>This measures completeness, not statistical confidence.</p>
              </details>
              <details>
                <summary>Missing records and timing</summary>
                <p>
                  Activity features use only earlier transaction timestamps
                  within one hour. Equal and future timestamps are excluded.
                  Relay times are used only for network evidence.
                </p>
                <p>
                  A missing fee is scored as zero and flagged with a warning.
                  Missing spending references never create graph links.
                </p>
              </details>
            </section>
          </>
        )}

        {page === "Help and methodology" && (
          <>
            <section className="panel">
              <h2>Working with a case</h2>
              <ol>
                <li>
                  Load the sample, or upload CSV, JSON or XML and inspect the
                  mapping.
                </li>
                <li>
                  Validate records. Download row-level errors and identify
                  partial evidence.
                </li>
                <li>Run analysis and review the feature comparisons.</li>
                <li>
                  Follow explicit UTXO links and review inferred groups
                  separately.
                </li>
                <li>
                  Add a note, set review status, save locally and export a case
                  backup.
                </li>
              </ol>
            </section>
            <LinuxSetup />
            <section className="panel">
              <h2>Interpretation and limits</h2>
              <ul>
                {limitations.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <p>
                Input address syntax is treated as an opaque identifier; Bitcoin
                checksum validation is not implemented. Synthetic identifiers
                are not spendable addresses. Initial funding transactions
                explicitly define the synthetic dataset boundary.
              </p>
              <p>
                Network correlation uses supplied TXID references, ports and
                timestamps. Timing alone never establishes an IP-to-address
                ownership link. Addresses, transactions and relays are distinct
                graph entities.
              </p>

              <a href="./data/malformed.json" download>
                Download malformed validation fixture
              </a>
            </section>
          </>
        )}
        {analysis && (
          <section className="print-report">
            <h2>Trace Ledger investigation report</h2>
            <p>Dataset SHA-256: {analysis.dataset.hash}</p>
            <p>
              Model: {analysis.modelVersion} · generated{" "}
              {new Date().toISOString()}
            </p>
            <pre>{JSON.stringify(analysis.settings, null, 2)}</pre>
            <p>{limitations.join(" ")}</p>
            <AlertTable
              rows={analysis.alerts.filter(
                (a) => a.category !== "Reference transaction",
              )}
              reviews={reviews}
              onSelect={() => {}}
            />
            {Object.entries(reviews).map(([id, r]) => (
              <p key={id}>
                {id}: {r.status} — {r.note}
              </p>
            ))}
          </section>
        )}
        <footer>
          Trace Ledger{" "}
          <span>
            {model?.version} ·{" "}
            {analysis
              ? analysis.elapsedMs.toFixed(1) + " ms analysis"
              : "No analysis loaded"}
          </span>
        </footer>
      </main>
    </div>
  );
}
function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function Empty({ onSample }: { onSample: () => void }) {
  return (
    <section className="panel empty">
      <h2>No analysis loaded</h2>
      <p>Load the sample or validate a dataset to begin.</p>
      <button className="primary" onClick={onSample}>
        Explore sample investigation
      </button>
    </section>
  );
}
function AlertTable({
  rows,
  reviews,
  onSelect,
}: {
  rows: Alert[];
  reviews: Record<string, Review>;
  onSelect: (a: Alert) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Transaction</th>
            <th>Category</th>
            <th>Anomaly percentile</th>
            <th>Evidence quality</th>
            <th>Supporting evidence</th>
            <th>Review</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.txid}>
              <td>
                <button
                  className="link"
                  title={a.txid}
                  onClick={() => onSelect(a)}
                >
                  {short(a.txid)}
                </button>
                <small>{a.timestamp.slice(0, 10)}</small>
              </td>
              <td>{a.category}</td>
              <td>
                <span className={a.percentile >= 95 ? "score high" : "score"}>
                  {a.percentile.toFixed(1)}
                </span>
              </td>
              <td>{a.quality.toFixed(0)}/100</td>
              <td className="flag-evidence">
                {a.support.slice(-2).map((e, i) => (
                  <small key={i}>{e}</small>
                ))}
                <button className="link" onClick={() => onSelect(a)}>
                  Inspect evidence
                </button>
              </td>
              <td>{reviews[a.txid]?.status || "new"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
