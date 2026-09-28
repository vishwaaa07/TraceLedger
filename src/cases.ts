import type { Analysis } from "./types";
export type Review = {
  status: "new" | "acknowledged" | "reviewed" | "dismissed";
  note: string;
};
export type CaseFile = {
  format: "trace-ledger-case";
  version: 1;
  exportedAt: string;
  analysis: Analysis;
  reviews: Record<string, Review>;
  limitations: string[];
};
export const limitations = [
  "Investigative leads, not determinations of criminal activity.",
  "Relay IP does not identify a wallet owner or transaction originator.",
  "Synthetic evaluation is not real-world criminality detection accuracy.",
  "No input-to-output fund allocation is claimed.",
  "Geo-IP is approximate. Inferred ownership and pattern safeguards are imperfect.",
];
export const caseFile = (
  analysis: Analysis,
  reviews: Record<string, Review>,
): CaseFile => ({
  format: "trace-ledger-case",
  version: 1,
  exportedAt: new Date().toISOString(),
  analysis,
  reviews,
  limitations,
});
export function readCase(text: string): CaseFile {
  if (text.length > 50 * 1024 * 1024) throw Error("Case exceeds 50 MiB limit");
  const c = JSON.parse(text);
  if (
    c.format !== "trace-ledger-case" ||
    c.version !== 1 ||
    !c.analysis?.dataset?.transactions?.length ||
    !Array.isArray(c.analysis.alerts) ||
    !c.reviews ||
    typeof c.reviews !== "object" ||
    Array.isArray(c.reviews) ||
    !/^[a-f0-9]{64}$/.test(c.analysis.dataset.hash) ||
    !Array.isArray(c.analysis.dataset.observations) ||
    typeof c.analysis.settings?.seed !== "string" ||
    typeof c.analysis.settings?.provenance !== "string"
  )
    throw Error("Invalid Trace Ledger case");
  for (const [id, review] of Object.entries(c.reviews) as [string, Review][]) {
    if (
      !/^[a-f0-9]{64}$/.test(id) ||
      !review ||
      !["new", "acknowledged", "reviewed", "dismissed"].includes(
        review.status,
      ) ||
      typeof review.note !== "string"
    )
      throw Error("Invalid case review record");
  }
  return c;
}
export function download(
  name: string,
  value: unknown,
  type = "application/json",
) {
  const b = new Blob(
    [typeof value === "string" ? value : JSON.stringify(value, null, 2)],
    { type },
  );
  const url = URL.createObjectURL(b);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const csvCell = (v: unknown) =>
  '"' +
  String(
    typeof v === "string" && /^[\s]*[=+@\-\t\r]/.test(v) ? "'" + v : (v ?? ""),
  ).replaceAll('"', '""') +
  '"';
export function evidenceCSV(a: Analysis, reviews: Record<string, Review>) {
  const rows = [
    [
      "dataset_sha256",
      "model_version",
      "settings",
      "limitations",
      "txid",
      "timestamp",
      "category",
      "anomaly_score",
      "anomaly_percentile",
      "evidence_quality",
      "status",
      "note",
      "supporting_observations",
      "transaction_source_and_provenance",
      "network_records",
      "seed_exposure",
    ],
    ...a.alerts.map((r) => [
      a.dataset.hash,
      a.modelVersion,
      JSON.stringify(a.settings),
      limitations.join(" "),
      r.txid,
      r.timestamp,
      r.category,
      r.score,
      r.percentile,
      r.quality,
      reviews[r.txid]?.status || "new",
      reviews[r.txid]?.note || "",
      JSON.stringify(r.support),
      JSON.stringify(a.dataset.transactions.find((t) => t.txid === r.txid)),
      JSON.stringify(a.dataset.observations.filter((o) => o.txid === r.txid)),
      JSON.stringify(a.exposure.find((e) => e.txid === r.txid) ?? null),
    ]),
  ];
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open("trace-ledger", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("cases");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(Error("Storage blocked"));
    } catch (e) {
      reject(e);
    }
  });
}
export async function storage(
  action: "save" | "load" | "clear",
  value?: CaseFile,
): Promise<CaseFile | undefined> {
  const d = await db();
  try {
    return await new Promise((resolve, reject) => {
      const t = d.transaction(
          "cases",
          action === "load" ? "readonly" : "readwrite",
        ),
        s = t.objectStore("cases");
      const r =
        action === "load"
          ? s.get("current")
          : action === "save"
            ? s.put(value, "current")
            : s.delete("current");
      t.oncomplete = () => resolve(action === "load" ? r.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    d.close();
  }
}
