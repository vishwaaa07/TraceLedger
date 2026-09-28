import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { parseGeoCSV, lookupDatabase, geoText } from "../src/geoDatabase";
import { features } from "../src/representation";
import { ingest } from "../src/ingest";
import { validateModel } from "../src/engine";
import type { Model } from "../src/types";
const model: Model = JSON.parse(
  readFileSync("public/model/isolation-forest.json", "utf8"),
);
describe("v2 representation and honest evaluation", () => {
  it("computes finite fitted graph embeddings and changes them when parent evidence is removed", async () => {
    const d = await ingest(
      readFileSync("public/data/sample.json", "utf8"),
      "json",
    );
    const v = features(d, model);
    expect(model.embedding.components).toHaveLength(4);
    for (const x of v.values()) {
      expect(x).toHaveLength(17);
      expect(x.every(Number.isFinite)).toBe(true);
    }
    const t = d.transactions.find((t) => t.inputs.length === 1)!;
    const missing = {
      ...d,
      transactions: d.transactions.map((x) =>
        x.txid === t.txid
          ? {
              ...x,
              inputs: x.inputs.map((i) => ({
                address: i.address,
                amount: i.amount,
              })),
            }
          : x,
      ),
    };
    expect(features(missing, model).get(t.txid)!.slice(13)).not.toEqual(
      v.get(t.txid)!.slice(13),
    );
  });
  it("rejects incompatible embedding metadata", () => {
    expect(() =>
      validateModel({
        ...model,
        embedding: { ...model.embedding, components: [] },
      }),
    ).toThrow();
  });
  it("keeps evaluation seeds out of selection and reports ablation plus stress tests", () => {
    const r = JSON.parse(readFileSync("public/model/evaluation.json", "utf8"));
    expect(
      new Set(Object.values(r.datasets).map((d: any) => d.seed)).size,
    ).toBe(5);
    expect(r.isolation_forest.recall).toBeGreaterThan(0.7);
    expect(r.isolation_forest.precision).toBeGreaterThan(0.8);
    expect(
      r.development_candidates[r.selected_representation].false_positive_rate,
    ).toBeLessThanOrEqual(0.1);
    expect(r.embedding_ablation.context_graph).toBeDefined();
    expect(r.stress_seeds).toHaveLength(3);
  });
});
describe("real local Geo-IP database", () => {
  it("indexes range boundaries and keeps reserved addresses unknown", () => {
    const d = parseGeoCSV(
      "8.8.8.0,8.8.8.255,US\n2001:4860::,2001:4860:ffff:ffff:ffff:ffff:ffff:ffff,US\n",
      "country",
      "test",
      "2026-09",
    );
    expect(lookupDatabase("8.8.8.0", d)).toBe("US");
    expect(lookupDatabase("8.8.8.255", d)).toBe("US");
    expect(lookupDatabase("8.8.9.0", d)).toBeNull();
    expect(lookupDatabase("2001:4860::8888", d)).toBe("US");
    expect(lookupDatabase("192.0.2.1", d)).toBeNull();
    expect(lookupDatabase("10.0.0.1", d)).toBeNull();
    expect(() =>
      parseGeoCSV(
        "8.8.8.0,8.8.8.255,US\n8.8.8.1,8.8.8.2,IN",
        "country",
        "test",
        "2026-09",
      ),
    ).toThrow("Overlapping");
    expect(() =>
      parseGeoCSV("bad,8.8.8.255,US", "country", "test", "2026-09"),
    ).toThrow();
  });
  it("verifies bundled provenance hashes and actual country/ASN lookup", async () => {
    const manifest = JSON.parse(
      readFileSync("public/geo/manifest.json", "utf8"),
    );
    for (const entry of manifest.databases) {
      const bytes = readFileSync("public/geo/" + entry.file);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        entry.sha256,
      );
      const db = parseGeoCSV(
        gunzipSync(bytes).toString("utf8"),
        entry.kind,
        "DB-IP Lite",
        manifest.release,
      );
      expect(db.ipv4.length + db.ipv6.length).toBe(entry.ranges);
      expect(lookupDatabase("8.8.8.8", db)).toBe(
        entry.kind === "country" ? "US" : "15169",
      );
      expect(lookupDatabase("192.0.2.2", db)).toBeNull();
    }
  }, 60000);
});
