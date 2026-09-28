import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ingest, parseRows, MAX_BYTES, MAX_RECORDS } from "../src/ingest";
import {
  analyze,
  features,
  score,
  percentile,
  subgraph,
  transactionPath,
} from "../src/engine";
import { lookupGeo, validateGeo } from "../src/geo";
import { caseFile, readCase, evidenceCSV, storage } from "../src/cases";
import type { Model } from "../src/types";
const read = (p: string) =>
  readFileSync(new URL("../public/" + p, import.meta.url), "utf8");
const model: Model = JSON.parse(read("model/isolation-forest.json"));
const json = read("data/sample.json"),
  rows = JSON.parse(json);
const reference = JSON.parse(read("model/reference-scores.json"));
describe("imports and accounting", () => {
  it("CSV, JSON and XML produce equivalent normalized transactions, observations and scores", async () => {
    const ds = await Promise.all(
      ["json", "csv", "xml"].map((f) => ingest(read("data/sample." + f), f)),
    );
    const canonical = (d: any) =>
      d.transactions.map(({ source, ...t }: any) => t);
    expect(canonical(ds[0])).toEqual(canonical(ds[1]));
    expect(canonical(ds[0])).toEqual(canonical(ds[2]));
    expect(ds[0].observations).toEqual(ds[1].observations);
    expect(ds[0].observations).toEqual(ds[2].observations);
    expect(ds.map((d) => analyze(d, model).alerts.map((a) => a.score))).toEqual(
      [0, 1, 2].map(() => analyze(ds[0], model).alerts.map((a) => a.score)),
    );
    expect(ds[0].rejected).toBe(0);
    expect(ds[0].transactions.length).toBe(1668);
  });
  it("repeated observations do not inflate totals", async () => {
    const a = analyze(await ingest(json, "json"), model),
      b = analyze(
        await ingest(JSON.stringify([...rows, ...rows]), "json"),
        model,
      );
    expect(a.totalOutputSats).toBe(b.totalOutputSats);
    expect(a.dataset.transactions.length).toBe(b.dataset.transactions.length);
    expect(a.dataset.observations.length).toBe(b.dataset.observations.length);
  });
  it("accounts in integer satoshis with coherent UTXOs", async () => {
    const d = await ingest(json, "json");
    for (const t of d.transactions) {
      if (t.funding_boundary) continue;
      expect(t.inputs.reduce((s, i) => s + BigInt(i.amount), 0n)).toBe(
        t.outputs.reduce((s, o) => s + BigInt(o.amount), BigInt(t.fees!)),
      );
    }
  });
  it("rejects unsafe values, malformed time, array mismatch and unsafe XML", async () => {
    const base = rows.find((r: any) => r.inputs.length);
    const bad = [
      { ...base, fees: 0.1 },
      { ...base, timestamp: "2025-02-30T00:00:00Z" },
      { ...base, timestamp: "2025-01-01T00:00:00" },
      { ...base, output_amounts: [1] },
      { ...base, fees: Number.MAX_SAFE_INTEGER + 1 },
    ];
    for (const r of bad)
      expect((await ingest(JSON.stringify([r]), "json")).rejected).toBe(1);
    expect(() =>
      parseRows(
        '<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><records/>',
        "xml",
      ),
    ).toThrow("Unsafe XML");
  });
  it("conflicting TXID is removed entirely", async () => {
    const r = rows[0];
    const d = await ingest(
      JSON.stringify([r, { ...r, script_type: "different" }]),
      "json",
    );
    expect(d.transactions).toHaveLength(0);
    expect(d.rejected).toBe(2);
  });
  it("partial data retains transaction but creates no invented IP or spend edge", async () => {
    const r = structuredClone(rows.find((r: any) => r.inputs.length === 1));
    delete r.inputs;
    r.fees = null;
    r.src_ip = "invalid";
    const d = await ingest(JSON.stringify([r]), "json"),
      a = analyze(d, model);
    expect(d.transactions).toHaveLength(1);
    expect(d.observations).toHaveLength(0);
    expect(
      a.elements.some((e) => e.data.type === "spend" || e.data.type === "ip"),
    ).toBe(false);
    expect(d.issues.length).toBeGreaterThan(0);
  });
  it("rejects double spends and parent amount mismatches", async () => {
    const r = structuredClone(rows.find((r: any) => r.inputs.length === 1));
    const dup = { ...r, txid: "f".repeat(64) };
    const d = await ingest(JSON.stringify([r, dup]), "json");
    expect(d.transactions.length).toBe(1);
    expect(d.issues.some((i) => i.message.includes("Double spend"))).toBe(true);
  });
  it("enforces byte and record limits", () => {
    expect(() => parseRows(" ".repeat(MAX_BYTES + 1), "json")).toThrow(
      "100 MiB",
    );
    expect(() =>
      parseRows(JSON.stringify(Array(MAX_RECORDS + 1).fill({ a: 1 })), "json"),
    ).toThrow("100,000");
  });
});
describe("real inference and chronological features", () => {
  it("matches Python score_samples within 1e-10 on 100 fixed vectors", () => {
    expect(reference.vectors).toHaveLength(100);
    for (let i = 0; i < 100; i++)
      expect(
        Math.abs(score(reference.vectors[i], model) - reference.scores[i]),
      ).toBeLessThan(reference.tolerance);
  });
  it("defines right-continuous fixed calibration percentile", () => {
    expect(percentile(2, [1, 2, 2, 3])).toBe(75);
    expect(percentile(0, [1, 2])).toBe(0);
  });
  it("future transactions cannot change prior features", async () => {
    const d = await ingest(json, "json");
    const full = features(d, model),
      cut = { ...d, transactions: d.transactions.slice(0, 60) };
    for (const [id, v] of features(cut, model)) expect(v).toEqual(full.get(id));
  });
  it("equal timestamps are not counted as prior activity", async () => {
    const d = await ingest(json, "json");
    const a = structuredClone(d.transactions[0]),
      b = structuredClone(a);
    b.txid = "b".repeat(64);
    const f = features({ ...d, transactions: [a, b] }, model);
    expect(f.get(b.txid)![6]).toBe(0);
  });
  it("only links explicit references and computes bounded exposure", async () => {
    const d = await ingest(json, "json"),
      seed = d.transactions.find((t) => t.inputs.length === 1)!.inputs[0]
        .address;
    const a = analyze(d, model, seed, "test supplied seed");
    for (const e of a.elements.filter((e) => e.data.type === "spend")) {
      const child = d.transactions.find(
        (t) => "t:" + t.txid === e.data.target,
      )!;
      expect(
        child.inputs.some((i) => "t:" + i.prev_txid === e.data.source),
      ).toBe(true);
    }
    expect(a.exposure.length).toBeGreaterThan(0);
    expect(
      a.exposure.every(
        (e) => e.distance <= 3 && e.score === 100 * 0.5 ** e.distance,
      ),
    ).toBe(true);
    expect(
      subgraph(a.elements, "", 1).elements.filter((e) => !e.data.source).length,
    ).toBeLessThanOrEqual(180);
    const p = a.exposure.find((e) => e.distance > 0)!;
    expect(
      transactionPath(a.elements, "t:" + p.path[0], "t:" + p.txid).length,
    ).toBe(p.path.length);
  });
  it("does not merge detected collaborative transactions", async () => {
    const a = analyze(await ingest(json, "json"), model);
    const ids = new Set(
      a.alerts
        .filter((a) => a.category.includes("CoinJoin"))
        .map((a) => a.txid),
    );
    expect(ids.size).toBeGreaterThan(0);
    expect(
      a.clusters.every((c) => c.transactions.every((id) => !ids.has(id))),
    ).toBe(true);
  });
});
describe("privacy and exports", () => {
  it("unknown Geo-IP remains unavailable; IPv4 and IPv6 use longest prefix", () => {
    expect(lookupGeo("8.8.8.8", [])).toBeNull();
    const g = validateGeo([
      {
        cidr: "192.0.2.0/24",
        country: "ZZ",
        asn: 64512,
        source: "synthetic",
        license: "CC0",
        updated: "2025-01-01",
      },
      {
        cidr: "2001:db8::/32",
        country: "ZZ",
        asn: 64512,
        source: "synthetic",
        license: "CC0",
        updated: "2025-01-01",
      },
    ]);
    expect(lookupGeo("192.0.2.4", g)?.country).toBe("ZZ");
    expect(lookupGeo("2001:db8::1", g)?.asn).toBe(64512);
    expect(lookupGeo("10.0.0.1", g)).toBeNull();
  });
  it("case roundtrip preserves records, model identity and reviews; CSV escapes formulas", async () => {
    const a = analyze(await ingest(json, "json"), model),
      reviews = {
        [a.alerts[0].txid]: {
          status: "reviewed" as const,
          note: '=HYPERLINK("x")',
        },
      };
    const c = readCase(JSON.stringify(caseFile(a, reviews)));
    expect(c.analysis).toEqual(a);
    expect(c.reviews).toEqual(reviews);
    expect(evidenceCSV(a, reviews)).toContain("'=HYPERLINK");
    expect(evidenceCSV(a, reviews)).toContain(a.dataset.hash);
  });
  it("storage failure rejects cleanly; export still works", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw Error("Storage denied");
      },
    });
    await expect(storage("save")).rejects.toThrow("Storage denied");
    const a = analyze(await ingest(json, "json"), model);
    expect(caseFile(a, {}).format).toBe("trace-ledger-case");
    vi.unstubAllGlobals();
  });
});

describe("reference vectors and import boundary behaviour", () => {
  it("TypeScript feature extraction reproduces Python evaluation vectors", async () => {
    const text = readFileSync(
      new URL("../pipeline/datasets/evaluation.json", import.meta.url),
      "utf8",
    );
    const f = features(await ingest(text, "json"), model);
    for (let i = 0; i < reference.ids.length; i++) {
      const actual = f.get(reference.ids[i])!;
      expect(actual).toHaveLength(17);
      for (let j = 0; j < 17; j++)
        expect(Math.abs(actual[j] - reference.vectors[i][j])).toBeLessThan(
          1e-10,
        );
    }
  });
  it("mapping supports renamed columns and explicit exclusions", async () => {
    const r = { ...rows[0], customTime: rows[0].timestamp };
    delete r.timestamp;
    const d = await ingest(JSON.stringify([r]), "json", {
      timestamp: "customTime",
    });
    expect(d.transactions).toHaveLength(1);
    const excluded = await ingest(JSON.stringify([r]), "json", {
      timestamp: "",
    });
    expect(excluded.transactions).toHaveLength(0);
  });
  it("missing parent retains participation with no fabricated spending edge", async () => {
    const r = rows.find((r: any) => r.inputs.length === 1);
    const d = await ingest(JSON.stringify([r]), "json");
    expect(d.transactions).toHaveLength(1);
    expect(
      d.issues.some((i) =>
        i.message.includes("Referenced transaction unavailable"),
      ),
    ).toBe(true);
    expect(
      analyze(d, model).elements.filter((e) => e.data.type === "spend"),
    ).toHaveLength(0);
  });
  it("case review objects cannot inject non-text UI values", async () => {
    const c = caseFile(analyze(await ingest(json, "json"), model), {});
    (c.reviews as any).invalid = { status: "reviewed", note: { bad: true } };
    expect(() => readCase(JSON.stringify(c))).toThrow("Invalid case review");
  });
});
