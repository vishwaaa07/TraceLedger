import React, { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import type { Analysis, Element } from "./types";
import { download } from "./cases";
import { lookupGeo, type GeoRow } from "./geo";
export function Graph({
  analysis,
  initialFocus,
  rpc,
  geo = [],
  theme = "light",
  onReview,
}: {
  analysis: Analysis;
  initialFocus: string;
  rpc: (action: string, args: any) => Promise<any>;
  geo?: GeoRow[];
  theme?: string;
  onReview: (id: string) => void;
}) {
  const startingFocus =
    initialFocus || (analysis.alerts[0] ? "t:" + analysis.alerts[0].txid : "");
  const host = useRef<HTMLDivElement>(null),
    cy = useRef<cytoscape.Core | null>(null);
  const [mode, setMode] = useState(
    initialFocus && !initialFocus.startsWith("t:") ? "entities" : "flow",
  );
  const [drawn, setDrawn] = useState<Element[]>([]);
  const [outputTruncated, setOutputTruncated] = useState(false);
  const [query, setQuery] = useState(startingFocus),
    [focus, setFocus] = useState(startingFocus),
    [depth, setDepth] = useState(1),
    [nodeType, setNodeType] = useState("all"),
    [edgeType, setEdgeType] = useState("all"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [selected, setSelected] = useState<any>(null),
    [view, setView] = useState<{
      elements: Element[];
      truncated: boolean;
      count: number;
    }>({ elements: [], truncated: false, count: 0 }),
    [message, setMessage] = useState(""),
    [target, setTarget] = useState("");
  useEffect(() => {
    setFocus(startingFocus);
    setQuery(startingFocus);
  }, [initialFocus]);
  useEffect(() => {
    let active = true;
    rpc("graph", {
      elements:
        mode === "flow"
          ? analysis.elements.filter(
              (e) => e.data.type === "transaction" || e.data.type === "spend",
            )
          : analysis.elements,
      focus,
      depth,
      nodeType,
      edgeType,
      from,
      to,
    })
      .then((r) => {
        if (active) {
          setView(r);
          setMessage("");
        }
      })
      .catch((e) => setMessage(String(e)));
    return () => {
      active = false;
    };
  }, [analysis, focus, depth, nodeType, edgeType, from, to, mode]);
  useEffect(() => {
    if (!host.current) return;
    const scores = new Map(
      analysis.alerts.map((a) => ["t:" + a.txid, a.percentile]),
    );
    const positions = new Map<string, { x: number; y: number }>();
    let rendered = view.elements;
    if (mode === "flow") {
      const nodes = view.elements
        .filter((e) => !e.data.source)
        .sort((a, b) =>
          String(a.data.timestamp).localeCompare(String(b.data.timestamp)),
        );
      const ranks = new Map<string, number>();
      const rows = new Map<number, number>();
      for (const n of nodes) {
        const parents = view.elements.filter(
          (e) => e.data.type === "spend" && e.data.target === n.data.id,
        );
        const rank = Math.max(
          0,
          ...parents.map((e) => (ranks.get(e.data.source!) ?? -1) + 1),
        );
        ranks.set(n.data.id, rank);
        const row = rows.get(rank) || 0;
        rows.set(rank, row + 1);
        positions.set(n.data.id, { x: rank * 500, y: row * 120 });
      }
      const outputNodes: Element[] = [],
        outputEdges: Element[] = [];
      const spends = view.elements.filter((e) => e.data.type === "spend");
      for (const e of spends) {
        const siblings = spends.filter(
          (x) =>
            x.data.source === e.data.source && x.data.target === e.data.target,
        );
        const outputIndex = Number(String(e.data.label).replace("vout ", ""));
        const parent = analysis.dataset.transactions.find(
          (t) => "t:" + t.txid === e.data.source,
        );
        const output = parent?.outputs.find((o) => o.index === outputIndex);
        const id = "outpoint:" + e.data.id;
        const left = positions.get(e.data.source!)!,
          right = positions.get(e.data.target!)!;
        positions.set(id, {
          x: (left.x + right.x) / 2,
          y:
            (left.y + right.y) / 2 +
            (siblings.indexOf(e) - (siblings.length - 1) / 2) * 85,
        });
        outputNodes.push({
          data: {
            id,
            type: "outpoint",
            label:
              "Output #" +
              outputIndex +
              "\n" +
              (output
                ? output.amount.toLocaleString() + " sats"
                : "Amount unavailable"),
            parentTx: parent?.txid,
            outputIndex,
            address: output?.address,
            amount: output?.amount,
          },
        });
        outputEdges.push(
          {
            data: {
              id: e.data.id + "|created",
              type: "spend",
              source: e.data.source,
              target: id,
              label: "",
            },
          },
          {
            data: {
              id: e.data.id + "|spent",
              type: "spend",
              source: id,
              target: e.data.target,
              label: "",
            },
          },
        );
      }
      const kept = outputNodes.slice(0, Math.max(0, 180 - nodes.length));
      const keepIds = new Set(kept.map((n) => n.data.id));
      setOutputTruncated(kept.length < outputNodes.length);
      rendered = [
        ...nodes,
        ...kept,
        ...outputEdges.filter(
          (e) => keepIds.has(e.data.source!) || keepIds.has(e.data.target!),
        ),
      ];
    }
    if (mode !== "flow") setOutputTruncated(false);
    setDrawn(rendered);
    const c = cytoscape({
      container: host.current,
      elements: rendered,
      style: [
        {
          selector: "node",
          style: {
            "background-color": "#588dab",
            label: (node: any) => {
              const d = node.data();
              const id = d.id.slice(d.id.indexOf(":") + 1);
              if (d.type === "outpoint") return d.label;
              if (mode === "flow")
                return (
                  "TX " +
                  id.slice(0, 10) +
                  "\nModel percentile " +
                  (scores.get(d.id)?.toFixed(1) ?? "N/A")
                );
              return d.type === "ip"
                ? id
                : (d.type === "transaction"
                    ? "TX "
                    : d.type === "cluster"
                      ? "Group "
                      : "") + id.slice(-8);
            },
            color: theme === "dark" ? "#e7eaf1" : "#253d53",
            "font-size": 12,
            "font-family": "Arial, Liberation Sans, sans-serif",
            "text-valign": "bottom",
            "text-margin-y": 7,
            width: 38,
            height: 38,
          },
        },
        {
          selector: 'node[type="transaction"]',
          style: {
            shape: "round-rectangle",
            "background-color": "#19334e",
            width: mode === "flow" ? 165 : 38,
            height: mode === "flow" ? 60 : 38,
            color:
              mode === "flow"
                ? "#ffffff"
                : theme === "dark"
                  ? "#e7eaf1"
                  : "#253d53",
            "text-valign": mode === "flow" ? "center" : "bottom",
            "text-wrap": "wrap",
            "text-margin-y": mode === "flow" ? 0 : 7,
          },
        },
        {
          selector: 'node[type="outpoint"]',
          style: {
            shape: "round-rectangle",
            width: 130,
            height: 46,
            "background-color": "#ddf1ed",
            color: "#153d38",
            "text-valign": "center",
            "text-margin-y": 0,
            "text-wrap": "wrap",
            "border-width": 1,
            "border-color": "#659b90",
          },
        },
        {
          selector: 'node[type="ip"]',
          style: { shape: "diamond", "background-color": "#a17b47" },
        },
        {
          selector: 'node[type="cluster"]',
          style: { shape: "hexagon", "background-color": "#8e77aa" },
        },
        {
          selector: "edge",
          style: {
            width: 1.4,
            "line-color": "#9aaec0",
            "target-arrow-color": "#9aaec0",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
          },
        },
        {
          selector: 'edge[type="observation"]',
          style: { "line-style": "dotted", "line-color": "#a17b47" },
        },
        {
          selector: 'edge[type="inferred"]',
          style: { "line-style": "dashed", "line-color": "#8e77aa" },
        },
        {
          selector: 'edge[type="spend"]',
          style: {
            "line-color": "#257c91",
            "target-arrow-color": "#257c91",
            width: 3,
            label: mode === "flow" ? "data(label)" : "",
            "font-size": 10,
            color: theme === "dark" ? "#e7eaf1" : "#253d53",
            "text-background-color": theme === "dark" ? "#192332" : "#fff",
            "text-background-opacity": 1,
            "text-background-padding": "3px",
          },
        },
        {
          selector: ".path",
          style: {
            "background-color": "#d88919",
            "line-color": "#d88919",
            "target-arrow-color": "#d88919",
          },
        },
        {
          selector: ":selected",
          style: { "border-width": 3, "border-color": "#d88919" },
        },
      ],
      layout:
        mode === "flow"
          ? {
              name: "preset",
              positions: (node: any) =>
                positions.get(node.id()) || { x: 0, y: 0 },
              padding: 50,
              fit: true,
            }
          : {
              name: "cose",
              animate: false,
              nodeRepulsion: () => 12000,
              idealEdgeLength: () => 120,
              padding: 45,
            },
      maxZoom: 2,
      wheelSensitivity: 0.25,
    });
    cy.current = c;
    if (message.startsWith("Supported path:")) c.elements().addClass("path");
    c.on("tap", "node", (e) => setSelected(e.target.data()));
    return () => {
      c.destroy();
    };
  }, [view, theme]);
  const find = (q: string) =>
    analysis.elements.find(
      (e) =>
        !e.data.source &&
        (e.data.id === q || e.data.id.slice(e.data.id.indexOf(":") + 1) === q),
    )?.data.id;
  async function highlight() {
    const a = find(query),
      b = find(target);
    if (!a || !b) {
      setMessage("Enter two exact TXIDs.");
      return;
    }
    const path: string[] = await rpc("path", {
      elements: analysis.elements,
      from: a,
      to: b,
    });
    if (!path.length) {
      setMessage("No supported directed UTXO path.");
      return;
    }
    const nodes = new Set(path.slice(0, 180));
    setView({
      elements: analysis.elements.filter(
        (e) =>
          nodes.has(e.data.id) ||
          (e.data.type === "spend" &&
            nodes.has(e.data.source!) &&
            nodes.has(e.data.target!)),
      ),
      count: path.length,
      truncated: path.length > 180,
    });
    setMessage(
      "Supported path: " +
        path.length +
        " transactions. No allocation to individual outputs is assumed.",
    );
  }
  return (
    <>
      <div className="segmented graph-mode">
        <button
          aria-pressed={mode === "flow"}
          onClick={() => {
            setMode("flow");
            setFocus(
              startingFocus.startsWith("t:")
                ? startingFocus
                : "t:" + analysis.alerts[0].txid,
            );
            setNodeType("all");
            setEdgeType("all");
          }}
        >
          Transaction flow
        </button>
        <button
          aria-pressed={mode === "entities"}
          onClick={() => setMode("entities")}
        >
          All entities
        </button>
      </div>
      <p className="muted">
        {mode === "flow"
          ? "Each output has its own block and lines: created by the transaction on the left, spent by the transaction on the right. Select a transaction for its model score and supporting evidence."
          : "Addresses, transactions, relay IPs and inferred groups. Select a node to inspect its evidence."}
      </p>
      <div className="toolbar">
        <input
          aria-label="Graph search"
          placeholder="Exact TXID, address or IP"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          onClick={() => {
            const id = find(query);
            if (id) {
              setMode(id.startsWith("t:") ? mode : "entities");
              setFocus(id);
              setMessage("");
            } else setMessage("No matching entity.");
          }}
        >
          Find entity
        </button>
        <label>
          Connection steps{" "}
          <select
            aria-label="Depth"
            value={depth}
            onChange={(e) => setDepth(+e.target.value)}
          >
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? "Direct links" : n + " steps away"}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => {
            setFocus(startingFocus);
            setQuery(startingFocus);
            setSelected(null);
            setDepth(1);
            setNodeType("all");
            setEdgeType("all");
            setFrom("");
            setTo("");
            cy.current?.fit();
          }}
        >
          Reset view
        </button>
      </div>
      <details className="graph-options">
        <summary>Filter by type or date</summary>
        <div className="toolbar">
          <label>
            Node type{" "}
            <select
              aria-label="Node type"
              value={nodeType}
              onChange={(e) => setNodeType(e.target.value)}
            >
              {["all", "transaction", "address", "ip", "cluster"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Relationship{" "}
            <select
              aria-label="Relationship"
              value={edgeType}
              onChange={(e) => setEdgeType(e.target.value)}
            >
              {[
                "all",
                "input",
                "output",
                "spend",
                "observation",
                "inferred",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            From{" "}
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            To{" "}
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
      </details>
      <div className="graph-actions toolbar">
        <button
          onClick={() =>
            cy.current?.zoom({
              level: Math.min(3, cy.current.zoom() * 1.25),
              renderedPosition: {
                x: (host.current?.clientWidth || 500) / 2,
                y: 240,
              },
            })
          }
        >
          Zoom in
        </button>
        <button
          onClick={() =>
            cy.current?.zoom({
              level: Math.max(0.1, cy.current.zoom() / 1.25),
              renderedPosition: {
                x: (host.current?.clientWidth || 500) / 2,
                y: 240,
              },
            })
          }
        >
          Zoom out
        </button>
        <button onClick={() => cy.current?.fit(undefined, 45)}>
          Fit to screen
        </button>
      </div>
      <div className="graph" ref={host} />
      <label>
        Inspect visible entity
        <select
          aria-label="Inspect visible entity"
          value={selected?.id || ""}
          onChange={(e) =>
            setSelected(
              drawn.find((n) => n.data.id === e.target.value)?.data || null,
            )
          }
        >
          <option value="">Select a node for evidence</option>
          {drawn
            .filter((e) => !e.data.source)
            .map((e) => (
              <option key={e.data.id} value={e.data.id}>
                {e.data.type}: {e.data.id.slice(e.data.id.indexOf(":") + 1)}
              </option>
            ))}
        </select>
      </label>
      <div className="graph-legend">
        <span>■ Transaction</span>
        <span>● Address</span>
        <span>◆ Relay IP</span>
        <span>⬡ Inferred group</span>
      </div>
      <details>
        <summary>What the lines mean</summary>
        <p>
          Arrows show direction. Solid lines show inputs and outputs; thick teal
          lines show a recorded spend. Dotted lines show relay observations;
          dashed lines show inferred associations.
        </p>
      </details>
      <p>
        {drawn.filter((e) => !e.data.source).length} visible blocks.{" "}
        {view.truncated || outputTruncated
          ? "Truncated to 180 nodes / 1,200 elements; focus a specific entity to explore its neighbourhood."
          : "Bounded graph view."}
      </p>
      <details>
        <summary>Find a path between two transactions</summary>
        <p>
          Use the search box above for the starting TXID, then enter a
          destination below.
        </p>
        <div className="toolbar">
          <input
            aria-label="Path destination"
            placeholder="Destination TXID for directed path"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
          <button onClick={highlight}>Highlight UTXO path</button>
        </div>
      </details>
      <div className="toolbar">
        <button
          onClick={() =>
            download("trace-ledger-graph.json", {
              dataset: analysis.dataset.hash,
              model: analysis.modelVersion,
              settings: analysis.settings,
              elements: drawn,
              evidenceElements: view.elements,
              limitations:
                "Inferred associations are hypotheses. No exact fund allocation.",
            })
          }
        >
          Export visible graph
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      {selected && (
        <section className="panel">
          <h3>
            Selected {selected.type === "outpoint" ? "output" : selected.type}
          </h3>
          <code>{selected.id}</code>
          {selected.type === "transaction" && (
            <div className="toolbar">
              <p>
                Model percentile:{" "}
                {analysis.alerts
                  .find((a) => "t:" + a.txid === selected.id)
                  ?.percentile.toFixed(1) ?? "Unavailable"}
                . Anomaly ranking, not a probability of crime.
              </p>
              <button onClick={() => onReview(selected.id.slice(2))}>
                Open analyst summary
              </button>
            </div>
          )}
          {selected.type === "ip" && (
            <p>
              Observed relay only. This is not evidence of ownership or
              transaction origin.
            </p>
          )}
          {selected.type === "ip" && (
            <p>
              {(() => {
                const g = lookupGeo(selected.id.slice(3), geo);
                return g
                  ? `${g.country} · AS${g.asn} · ${g.source} · updated ${g.updated}`
                  : "Geo-IP unavailable";
              })()}
            </p>
          )}
          <button
            onClick={() => {
              setFocus(
                selected.type === "outpoint"
                  ? "t:" + selected.parentTx
                  : selected.id,
              );
              setQuery(
                selected.type === "outpoint"
                  ? "t:" + selected.parentTx
                  : selected.id,
              );
              setDepth(Math.min(3, depth + 1));
            }}
          >
            Expand neighbourhood
          </button>
          <details>
            <summary>View source records</summary>
            <pre>
              {JSON.stringify(
                selected.type === "outpoint"
                  ? selected
                  : selected.type === "transaction"
                    ? analysis.dataset.transactions.find(
                        (t) => "t:" + t.txid === selected.id,
                      )
                    : selected.type === "cluster"
                      ? analysis.clusters.find((t) => t.id === selected.id)
                      : selected.type === "ip"
                        ? analysis.dataset.observations.filter(
                            (o) =>
                              "ip:" + o.src_ip === selected.id ||
                              "ip:" + o.dst_ip === selected.id,
                          )
                        : analysis.dataset.transactions.filter((t) =>
                            [...t.inputs, ...t.outputs].some(
                              (a) => "a:" + a.address === selected.id,
                            ),
                          ),
                null,
                2,
              )}
            </pre>
          </details>
        </section>
      )}
    </>
  );
}
