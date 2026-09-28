import type { Dataset, Model, Analysis, Element, Exposure } from "./types";
export const FEATURE_NAMES = [
  "log_output_sats",
  "input_count",
  "output_count",
  "log_fee_sats",
  "largest_output_share",
  "output_cv",
  "prior_address_1h",
  "prior_parent_count",
];
export function features(d: Dataset): Map<string, number[]> {
  const history = new Map<string, number[]>(),
    seen = new Map<string, number>(),
    result = new Map<string, number[]>();
  for (const tx of [...d.transactions].sort(
    (a, b) =>
      a.timestamp.localeCompare(b.timestamp) || a.txid.localeCompare(b.txid),
  )) {
    const now = Date.parse(tx.timestamp),
      amounts = tx.outputs.map((o) => o.amount),
      total = amounts.reduce((a, b) => a + b, 0),
      mean = total / amounts.length;
    const cv = mean
      ? Math.sqrt(
          amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length,
        ) / mean
      : 0;
    const addresses = new Set(
      [...tx.inputs, ...tx.outputs].map((a) => a.address),
    );
    let activity = 0;
    for (const a of addresses)
      activity += (history.get(a) || []).filter(
        (t) => now - 3600000 <= t && t < now,
      ).length;
    const parents = tx.inputs.filter(
      (i) =>
        i.prev_txid && seen.has(i.prev_txid) && seen.get(i.prev_txid)! < now,
    ).length;
    result.set(tx.txid, [
      Math.log1p(total),
      tx.inputs.length,
      tx.outputs.length,
      Math.log1p(tx.fees ?? 0),
      total ? Math.max(...amounts) / total : 0,
      cv,
      activity,
      parents,
    ]);
    for (const a of addresses)
      history.set(a, [
        ...(history.get(a) || []).filter((t) => t >= now - 3600000),
        now,
      ]);
    seen.set(tx.txid, now);
  }
  return result;
}
const c = (n: number) =>
  n <= 1
    ? 0
    : n === 2
      ? 1
      : 2 * (Math.log(n - 1) + 0.5772156649015329) - (2 * (n - 1)) / n;
export function validateModel(m: Model) {
  if (
    m.schema_version !== 1 ||
    JSON.stringify(m.features) !== JSON.stringify(FEATURE_NAMES) ||
    !m.trees?.length ||
    !m.calibration_scores?.length
  )
    throw Error("Missing or incompatible model artifact");
}
export function score(x: number[], m: Model): number {
  let depth = 0;
  for (const t of m.trees) {
    let n = 0,
      d = 0;
    while (t.left[n] !== -1) {
      n =
        Math.fround(x[t.feature[n]]) <= t.threshold[n] ? t.left[n] : t.right[n];
      d++;
    }
    depth += d + c(t.samples[n]);
  }
  return Math.pow(2, -depth / (m.trees.length * c(m.max_samples)));
}
export function percentile(s: number, cal: number[]) {
  let lo = 0,
    hi = cal.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cal[mid] <= s) lo = mid + 1;
    else hi = mid;
  }
  return (100 * lo) / cal.length;
}
export function analyze(
  d: Dataset,
  m: Model,
  seed = "",
  provenance = "",
): Analysis {
  const start = performance.now();
  validateModel(m);
  if (!d.transactions.length) throw Error("No valid transactions to analyze");
  const vectors = features(d),
    elements: Element[] = [],
    nodeIds = new Set<string>(),
    edgeIds = new Set<string>(),
    txById = new Map(d.transactions.map((t) => [t.txid, t]));
  const addNode = (
    id: string,
    type: string,
    label: string,
    timestamp?: string,
  ) => {
    if (!nodeIds.has(id)) {
      nodeIds.add(id);
      elements.push({ data: { id, type, label, timestamp } });
    }
  };
  const edge = (
    source: string,
    target: string,
    type: string,
    label = "",
    suffix = "",
  ) => {
    const id = [type, source, target, suffix].join("|");
    if (!edgeIds.has(id)) {
      edgeIds.add(id);
      elements.push({ data: { id, source, target, type, label } });
    }
  };
  const coinjoin = new Set<string>(),
    peel = new Set<string>(),
    children = new Map<string, string[]>(),
    links = new Map<string, string[]>();
  for (const t of d.transactions) {
    const values = t.outputs.map((o) => o.amount),
      counts = new Map<number, number>();
    for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
    if (
      t.inputs.length >= 3 &&
      t.outputs.length >= 3 &&
      Math.max(...counts.values()) >= 3
    )
      coinjoin.add(t.txid);
    addNode("t:" + t.txid, "transaction", t.txid.slice(0, 10), t.timestamp);
    for (const i of t.inputs) {
      addNode("a:" + i.address, "address", i.address.slice(0, 16));
      edge("a:" + i.address, "t:" + t.txid, "input");
      if (i.prev_txid && txById.has(i.prev_txid)) {
        edge(
          "t:" + i.prev_txid,
          "t:" + t.txid,
          "spend",
          "vout " + i.prev_index,
          String(i.prev_index),
        );
        children.set(i.prev_txid, [
          ...(children.get(i.prev_txid) || []),
          t.txid,
        ]);
        links.set(i.prev_txid, [...(links.get(i.prev_txid) || []), t.txid]);
      }
    }
    for (const o of t.outputs) {
      addNode("a:" + o.address, "address", o.address.slice(0, 16));
      edge(
        "t:" + t.txid,
        "a:" + o.address,
        "output",
        o.amount + " sats",
        String(o.index),
      );
    }
  }
  const shape = (id: string) => {
    const t = txById.get(id)!;
    return (
      t.outputs.length === 2 &&
      Math.max(...t.outputs.map((o) => o.amount)) /
        t.outputs.reduce((s, o) => s + o.amount, 0) >=
        0.9
    );
  };
  for (const t of d.transactions)
    if (shape(t.txid) && (children.get(t.txid) || []).some((id) => shape(id))) {
      peel.add(t.txid);
      for (const id of children.get(t.txid) || []) if (shape(id)) peel.add(id);
    }
  for (const o of d.observations) {
    for (const ip of new Set([o.src_ip, o.dst_ip])) {
      addNode("ip:" + ip, "ip", ip);
      edge("ip:" + ip, "t:" + o.txid, "observation", "relay observation", o.id);
    }
  }
  // Conservative common-input union; detected collaborative structures do not merge.
  const parent = new Map<string, string>(),
    reasons: { addresses: string[]; txid: string }[] = [];
  const root = (a: string): string => {
    if (!parent.has(a)) parent.set(a, a);
    let r = a;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const t of d.transactions)
    if (t.inputs.length >= 2 && !coinjoin.has(t.txid)) {
      const aa = [...new Set(t.inputs.map((i) => i.address))];
      for (const a of aa) parent.set(root(a), root(aa[0]));
      reasons.push({ addresses: aa, txid: t.txid });
    }
  const grouped = new Map<string, string[]>();
  for (const a of parent.keys()) {
    const r = root(a);
    grouped.set(r, [...(grouped.get(r) || []), a]);
  }
  const clusters = [...grouped.values()]
    .filter((a) => a.length > 1)
    .map((addresses, i) => ({
      id: "cluster:" + i,
      addresses,
      transactions: reasons
        .filter((r) => r.addresses.some((a) => addresses.includes(a)))
        .map((r) => r.txid),
    }));
  for (const cl of clusters) {
    addNode(
      cl.id,
      "cluster",
      "Inferred group " + (Number(cl.id.split(":")[1]) + 1),
    );
    for (const a of cl.addresses)
      edge(cl.id, "a:" + a, "inferred", "common-input hypothesis");
  }
  const exposure: Exposure[] = [];
  if (seed) {
    if (!provenance.trim()) throw Error("Seed provenance required");
    const queue = d.transactions
      .filter((t) =>
        [...t.inputs, ...t.outputs].some((i) => i.address === seed),
      )
      .map((t) => ({ id: t.txid, path: [t.txid], distance: 0 }));
    const visited = new Set<string>();
    while (queue.length) {
      const item = queue.shift()!;
      if (visited.has(item.id)) continue;
      visited.add(item.id);
      exposure.push({
        txid: item.id,
        score: 100 * 0.5 ** item.distance,
        distance: item.distance,
        path: item.path,
        seed,
        provenance,
      });
      if (item.distance < 3)
        for (const id of links.get(item.id) || [])
          queue.push({
            id,
            path: [...item.path, id],
            distance: item.distance + 1,
          });
    }
  }
  const alerts = d.transactions
    .map((t) => {
      const x = vectors.get(t.txid)!,
        s = score(x, m),
        p = percentile(s, m.calibration_scores),
        obs = d.observations.filter((o) => o.txid === t.txid);
      const resolved = t.inputs.filter(
        (i) => i.prev_txid && txById.has(i.prev_txid),
      ).length;
      const quality =
        25 +
        (t.fees !== null ? 25 : 0) +
        (t.inputs.length
          ? (25 * resolved) / t.inputs.length
          : t.funding_boundary
            ? 25
            : 0) +
        (obs.length ? 25 : 0);
      const category =
        [
          s >= m.alert_threshold ? "ML anomaly" : null,
          peel.has(t.txid) ? "Peeling-like baseline" : null,
          coinjoin.has(t.txid) ? "CoinJoin-like baseline" : null,
        ]
          .filter(Boolean)
          .join(" · ") || "Reference transaction";
      const support = [
        ...(obs.length
          ? [
              "Observed relay time range: " +
                obs.map((o) => o.timestamp).sort()[0] +
                " to " +
                obs
                  .map((o) => o.timestamp)
                  .sort()
                  .at(-1) +
                "; ports retained in source records",
            ]
          : []),
        `${obs.length} valid relay observations; relay does not establish origin or ownership`,
        `${resolved}/${t.inputs.length} input references resolved`,
        ...(peel.has(t.txid)
          ? [
              "Two linked two-output transactions with ≥90% largest-output share; legitimate change can look similar",
            ]
          : []),
        ...(coinjoin.has(t.txid)
          ? [
              "At least three inputs/outputs and three equal outputs; privacy use is not wrongdoing",
            ]
          : []),
        ...(s >= m.alert_threshold
          ? [
              "Isolation Forest score exceeds calibration 95th-percentile threshold",
            ]
          : []),
      ];
      return {
        txid: t.txid,
        category,
        score: s,
        percentile: p,
        features: x,
        quality,
        support,
        timestamp: t.timestamp,
      };
    })
    .sort((a, b) => b.score - a.score || a.txid.localeCompare(b.txid));
  return {
    dataset: d,
    modelVersion: m.version,
    alerts,
    elements,
    clusters,
    exposure,
    elapsedMs: performance.now() - start,
    settings: {
      threshold: m.alert_threshold,
      seed,
      provenance,
      maxHops: 3,
      decay: 0.5,
    },
    totalOutputSats: d.transactions
      .reduce(
        (s, t) => s + t.outputs.reduce((a, o) => a + BigInt(o.amount), 0n),
        0n,
      )
      .toString(),
    totalFeeSats: d.transactions
      .reduce((s, t) => s + BigInt(t.fees ?? 0), 0n)
      .toString(),
  };
}
export function subgraph(
  elements: Element[],
  focus: string,
  depth = 1,
  nodeType = "all",
  edgeType = "all",
  from = "",
  to = "",
  limit = 180,
) {
  const nodes = elements.filter(
    (e) =>
      !e.data.source &&
      (!e.data.timestamp ||
        ((!from || e.data.timestamp >= from) &&
          (!to || e.data.timestamp <= to + "T23:59:59.999Z"))) &&
      (nodeType === "all" || e.data.type === nodeType),
  );
  const allowed = new Set(nodes.map((e) => e.data.id));
  const edges = elements.filter(
    (e) =>
      e.data.source &&
      (edgeType === "all" || e.data.type === edgeType) &&
      allowed.has(e.data.source!) &&
      allowed.has(e.data.target!),
  );
  let chosen = new Set<string>();
  if (focus && allowed.has(focus)) {
    chosen.add(focus);
    for (let d = 0; d < Math.min(depth, 3); d++) {
      const next = new Set(chosen);
      for (const e of edges)
        if (chosen.has(e.data.source!) || chosen.has(e.data.target!)) {
          next.add(e.data.source!);
          next.add(e.data.target!);
        }
      chosen = next;
    }
  } else nodes.slice(0, limit).forEach((e) => chosen.add(e.data.id));
  const count = focus ? chosen.size : nodes.length,
    selected = new Set([...chosen].slice(0, limit));
  const visible = [
    ...nodes.filter((e) => selected.has(e.data.id)),
    ...edges.filter(
      (e) => selected.has(e.data.source!) && selected.has(e.data.target!),
    ),
  ];
  return {
    elements: visible.slice(0, 1200),
    truncated: count > limit || visible.length > 1200,
    count,
  };
}
export function transactionPath(elements: Element[], from: string, to: string) {
  const adjacency = new Map<string, string[]>();
  for (const e of elements)
    if (e.data.type === "spend")
      adjacency.set(e.data.source!, [
        ...(adjacency.get(e.data.source!) || []),
        e.data.target!,
      ]);
  const q = [from],
    parent = new Map<string, string | null>([[from, null]]);
  for (let index = 0; index < q.length; index++) {
    const id = q[index];
    if (id === to) {
      const path: string[] = [];
      let current: string | null = id;
      while (current !== null) {
        path.unshift(current);
        current = parent.get(current)!;
      }
      return path;
    }
    for (const child of adjacency.get(id) || [])
      if (!parent.has(child)) {
        parent.set(child, id);
        q.push(child);
      }
  }
  return [];
}
