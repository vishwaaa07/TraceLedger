import { useState, useRef, useLayoutEffect } from "react";
import type { Analysis, Alert } from "./types";
import type { Review } from "./cases";

export function CaseOverview({
  analysis,
  reviews,
  onSelect,
  onGraph,
}: {
  analysis: Analysis;
  reviews: Record<string, Review>;
  onSelect: (alert: Alert) => void;
  onGraph: (id: string) => void;
}) {
  const [filter, setFilter] = useState("new");
  const [index, setIndex] = useState(0);
  const leads = analysis.alerts.filter(
    (a) => a.category !== "Reference transaction",
  );
  const focus = leads[index % Math.max(1, leads.length)] || analysis.alerts[0];
  const tx = analysis.dataset.transactions.find((t) => t.txid === focus?.txid);
  const flowHost = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<string[]>([]);
  useLayoutEffect(() => {
    const host = flowHost.current;
    if (!host) return;
    const measure = () => {
      const root = host.getBoundingClientRect(),
        center = host.querySelector(".network-center")?.getBoundingClientRect();
      if (!center) return;
      const paths: string[] = [];
      host.querySelectorAll("[data-flow]").forEach((el) => {
        const siblings = Array.from(host.querySelectorAll(`[data-flow="${el.getAttribute("data-flow")}"]`));
        const portY = center.top + center.height * (siblings.indexOf(el) + 1) / (siblings.length + 1);
        const r = el.getBoundingClientRect(),
          input = el.getAttribute("data-flow") === "input";
        const x1 = (input ? r.right : center.right) - root.left,
          y1 =
            (input ? r.top + r.height / 2 : portY) -
            root.top,
          x2 = (input ? center.left : r.left) - root.left - 3,
          y2 =
            (input ? portY : r.top + r.height / 2) -
            root.top;
        paths.push(
          `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`,
        );
      });
      setLines(paths);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    measure();
    return () => observer.disconnect();
  }, [tx?.txid]);
  const rows = leads.filter(
    (a) => filter === "all" || (reviews[a.txid]?.status || "new") === filter,
  );
  const neighbours = tx
    ? [
        ...tx.inputs.slice(0, 3).map((i) => ({ id: i.address, kind: "Input" })),
        ...tx.outputs
          .slice(0, 3)
          .map((o) => ({ id: o.address, kind: "Output" })),
      ]
    : [];
  const observed = new Set(analysis.dataset.observations.map((o) => o.txid));
  const coverage = Math.round(
    (100 *
      analysis.dataset.transactions.filter((t) => observed.has(t.txid))
        .length) /
      Math.max(1, analysis.dataset.transactions.length),
  );
  return (
    <div className="case-grid">
      <section className="panel network-card">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">CONNECTED EVIDENCE</span>
            <h2>Transaction neighbourhood</h2>
          </div>
          <button
            disabled={leads.length < 2}
            onClick={() => setIndex((i) => i + 1)}
            aria-label="Next transaction neighbourhood"
          >
            Next →
          </button>
        </div>
        {tx ? (
          <>
            <div className="transaction-flow-preview" ref={flowHost}>
              <svg className="individual-connections" aria-hidden="true">
                <defs>
                  <marker
                    id="flow-arrow"
                    markerUnits="userSpaceOnUse"
                    markerWidth="9"
                    markerHeight="10"
                    refX="8"
                    refY="5"
                    orient="auto"
                  >
                    <path d="M0 1 L8 5 L0 9 Z" fill="#8b65d4" />
                  </marker>
                </defs>
                {lines.map((d, i) => (
                  <path
                    key={i}
                    d={d}
                    fill="none"
                    stroke="#8b65d4"
                    strokeWidth="1.8"
                    markerEnd="url(#flow-arrow)"
                  />
                ))}
              </svg>
              <div>
                <h3>
                  Inputs <small>Spent outputs</small>
                </h3>
                {tx.inputs.slice(0, 3).map((n, i) => (
                  <button
                    data-flow="input"
                    key={i}
                    onClick={() => onGraph("a:" + n.address)}
                    title={n.address}
                  >
                    <span>{n.address.slice(-10)}</span>
                    <small>{n.amount.toLocaleString()} sats</small>
                  </button>
                ))}
              </div>
              <div className="flow-middle">
                <button
                  className="network-center"
                  onClick={() => onSelect(focus)}
                >
                  <strong>Transaction</strong>
                  <small>{tx.txid.slice(0, 10)}…</small>
                  <small>Percentile {focus.percentile.toFixed(1)}</small>
                </button>
              </div>
              <div>
                <h3>
                  Outputs <small>Created outputs</small>
                </h3>
                {tx.outputs.slice(0, 3).map((n, i) => (
                  <button
                    data-flow="output"
                    key={i}
                    onClick={() => onGraph("a:" + n.address)}
                    title={n.address}
                  >
                    <span>
                      #{n.index} · {n.address.slice(-8)}
                    </span>
                    <small>{n.amount.toLocaleString()} sats</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="network-caption">
              <span>
                {tx.inputs.length} inputs · {tx.outputs.length} outputs
                <br />
                <small>
                  Up to 3 per side. No individual input-to-output allocation.
                </small>
              </span>
              <button onClick={() => onGraph("t:" + tx.txid)}>
                Open graph ↗
              </button>
            </div>
          </>
        ) : (
          <p>No transactions available.</p>
        )}
      </section>
      <section className="panel queue-card">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">ANALYST WORKSPACE</span>
            <h2>Review queue</h2>
          </div>
          <span className="count-pill">{rows.length}</span>
        </div>
        <div className="segmented" role="group" aria-label="Queue status">
          {["new", "reviewed", "all"].map((s) => (
            <button
              key={s}
              aria-pressed={filter === s}
              onClick={() => setFilter(s)}
            >
              {s === "new"
                ? "Unreviewed"
                : s === "all"
                  ? "All leads"
                  : "Reviewed"}
            </button>
          ))}
        </div>
        <div className="queue-list">
          {rows.slice(0, 3).map((a) => (
            <button
              className="queue-row"
              key={a.txid}
              onClick={() => onSelect(a)}
            >
              <span className="tx-icon">TX</span>
              <span>
                <strong>{a.txid.slice(0, 14)}…</strong>
                <small>{a.category}</small>
              </span>
              <span className="queue-score">
                {a.percentile.toFixed(1)}
                <small>percentile ↗</small>
              </span>
            </button>
          ))}
          {rows.length === 0 && (
            <p className="queue-empty">
              No {filter === "new" ? "unreviewed" : filter} leads.
            </p>
          )}
        </div>
        <div className="coverage">
          <div>
            <span>Transactions with relay observations</span>
            <strong>{coverage}%</strong>
          </div>
          <progress max="100" value={coverage} />
        </div>
      </section>
    </div>
  );
}

export function GettingStarted({
  navigate,
}: {
  navigate: (page: string) => void;
}) {
  return (
    <section className="welcome-grid">
      <div className="welcome-case">
        <h2>Follow the transaction trail.</h2>
        <p>Payments, peer observations and connected outputs.</p>
        <div className="case-route" aria-label="Illustrative UTXO sequence">
          <span>Funding</span>
          <i>→</i>
          <span>Transaction</span>
          <i>→</i>
          <span>Outputs</span>
        </div>
        <div className="scenario-tags">
          <span>Ordinary payments</span>
          <span>Batch transfers</span>
          <span>Peeling-like sequences</span>
          <span>CoinJoin-like structures</span>
        </div>
        <small>Illustrative transaction sequence</small>
      </div>
      <div className="panel setup-card">
        <span className="eyebrow">YOUR NEXT STEPS</span>
        <h2>No dataset loaded</h2>
        <button onClick={() => navigate("Import data")}>
          <b>01</b>
          <span>
            <strong>Import & validate</strong>
            <small>CSV, JSON or XML · up to 50 MiB</small>
          </span>
          <i>↗</i>
        </button>
        <button onClick={() => navigate("Model and evaluation")}>
          <b>02</b>
          <span>
            <strong>Inspect the model</strong>
            <small>Features, scores and evaluation</small>
          </span>
          <i>↗</i>
        </button>
        <button onClick={() => navigate("Investigations")}>
          <b>03</b>
          <span>
            <strong>Resume a case</strong>
            <small>Restore a saved investigation</small>
          </span>
          <i>↗</i>
        </button>
      </div>
    </section>
  );
}
