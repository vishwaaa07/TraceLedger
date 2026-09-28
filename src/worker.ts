import { ingest, parseRows } from "./ingest";
import { analyze, subgraph, transactionPath } from "./engine";
self.onmessage = async (e: MessageEvent) => {
  const { id, action, ...args } = e.data;
  try {
    if (action === "similar") {
      const vectors = args.vectors as { txid: string; vector: number[] }[];
      const target = vectors.find((v) => v.txid === args.txid);
      if (!target || target.vector.length !== 4)
        throw Error("Graph embedding unavailable");
      const result = vectors
        .filter((v) => v.txid !== args.txid)
        .map((v) => ({
          txid: v.txid,
          distance: Math.sqrt(
            v.vector.reduce((s, x, j) => s + (x - target.vector[j]) ** 2, 0),
          ),
        }))
        .sort((a, b) => a.distance - b.distance || a.txid.localeCompare(b.txid))
        .slice(0, 5);
      self.postMessage({ id, result });
      return;
    }
    const progress = (value: number, message: string) =>
      self.postMessage({ id, progress: value, message });
    if (action === "preview") {
      progress(10, "Parsing input");
      const rows = parseRows(args.text, args.format);
      self.postMessage({
        id,
        result: {
          columns: Object.keys(rows[0]),
          rows: rows.slice(0, 5),
          count: rows.length,
        },
      });
    }
    if (action === "ingest") {
      progress(15, "Parsing and validating records");
      const d = await ingest(
        args.text,
        args.format,
        args.mapping,
        (done, total) =>
          progress(
            15 + Math.floor((done / total) * 70),
            `Validating ${done.toLocaleString()} / ${total.toLocaleString()} records`,
          ),
      );
      progress(100, "Validation complete");
      self.postMessage({ id, result: d });
    }
    if (action === "analyze") {
      progress(20, "Extracting chronological features");
      const result = analyze(
        args.dataset,
        args.model,
        args.seed,
        args.provenance,
      );
      progress(100, "Scoring and graph complete");
      self.postMessage({ id, result });
    }
    if (action === "graph")
      self.postMessage({
        id,
        result: subgraph(
          args.elements,
          args.focus,
          args.depth,
          args.nodeType,
          args.edgeType,
          args.from,
          args.to,
        ),
      });
    if (action === "path")
      self.postMessage({
        id,
        result: transactionPath(args.elements, args.from, args.to),
      });
  } catch (err) {
    self.postMessage({
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
