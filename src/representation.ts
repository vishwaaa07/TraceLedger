import type { Dataset, Model } from "./types";
export const FEATURE_NAMES = [
  "log_output_sats",
  "input_count",
  "output_count",
  "log_fee_sats",
  "largest_output_share",
  "output_cv",
  "prior_address_1h",
  "prior_parent_count",
  "log_parent_gap_seconds",
  "prior_chain_depth",
  "parent_mean_output_share",
  "prior_fast_chain",
  "prior_retained_chain",
  "graph_embedding_1",
  "graph_embedding_2",
  "graph_embedding_3",
  "graph_embedding_4",
];
type Prior = {
  time: number;
  depth: number;
  fast: number;
  retained: number;
  share: number;
  own: number[];
  pmean: number[];
};
const average = (a: number[][]) =>
  Array.from({ length: 6 }, (_, j) =>
    a.length ? a.reduce((s, v) => s + v[j], 0) / a.length : 0,
  );
const lowerBound = (a: number[], value: number) => {
  let lo = 0,
    hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (a[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};
export function features(d: Dataset, m?: Model): Map<string, number[]> {
  const history = new Map<string, number[]>(),
    seen = new Map<string, Prior>(),
    result = new Map<string, number[]>();
  for (const t of [...d.transactions].sort(
    (a, b) =>
      Date.parse(a.timestamp) - Date.parse(b.timestamp) ||
      a.txid.localeCompare(b.txid),
  )) {
    const now = Date.parse(t.timestamp) / 1000,
      amounts = t.outputs.map((o) => o.amount),
      total = amounts.reduce((s, a) => s + a, 0),
      mean = total / amounts.length;
    const share = total ? Math.max(...amounts) / total : 0,
      cv = mean
        ? Math.sqrt(
            amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length,
          ) / mean
        : 0;
    const addresses = new Set(
      [...t.inputs, ...t.outputs].map((a) => a.address),
    );
    let activity = 0;
    for (const a of addresses) {
      const times = history.get(a) || [];
      activity += lowerBound(times, now) - lowerBound(times, now - 3600);
    }
    const parents = t.inputs
      .map((i) => seen.get(i.prev_txid || ""))
      .filter((p): p is Prior => !!p && p.time < now);
    const gap = parents.length
      ? Math.min(...parents.map((p) => now - p.time))
      : 86400;
    const depth = parents.length
      ? 1 + Math.max(...parents.map((p) => p.depth))
      : 0;
    const fast =
      parents.length && gap < 60
        ? 1 + Math.max(...parents.map((p) => p.fast))
        : 0;
    const retained =
      parents.length && share >= 0.9
        ? 1 + Math.max(...parents.map((p) => p.retained))
        : 0;
    const parentShare = parents.length
      ? parents.reduce((s, p) => s + p.share, 0) / parents.length
      : 0;
    const v = [
      Math.log1p(total),
      t.inputs.length,
      amounts.length,
      Math.log1p(t.fees ?? 0),
      share,
      cv,
      activity,
      parents.length,
      Math.log1p(Math.min(gap, 86400)),
      Math.min(depth, 20),
      parentShare,
      Math.min(fast, 20),
      Math.min(retained, 20),
    ];
    const own = [
      Math.log1p(t.inputs.length),
      Math.log1p(amounts.length),
      share,
      Math.log1p(activity),
      v[8],
      Math.log1p(Math.min(depth, 20)),
    ];
    const pmean = average(parents.map((p) => p.own)),
      gmean = average(parents.map((p) => p.pmean));
    if (m?.embedding) {
      const e = m.embedding,
        z = [...own, ...pmean, ...gmean].map(
          (x, j) => (x - e.mean[j]) / e.scale[j] - e.pca_mean[j],
        );
      v.push(
        ...e.components.map((row) => row.reduce((s, c, j) => s + c * z[j], 0)),
      );
    }
    result.set(t.txid, v);
    seen.set(t.txid, { time: now, depth, fast, retained, share, own, pmean });
    for (const a of addresses) {
      const times = history.get(a) || [];
      times.push(now);
      history.set(a, times);
    }
  }
  return result;
}
