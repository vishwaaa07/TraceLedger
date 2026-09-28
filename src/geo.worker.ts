import {
  geoText,
  parseGeoCSV,
  lookupDatabase,
  type GeoDatabase,
  type GeoKind,
} from "./geoDatabase";
import { validateGeo, lookupGeo, type GeoRow } from "./geo";
let databases: Partial<Record<GeoKind, GeoDatabase>> = {},
  custom: GeoRow[] = [];
self.onmessage = async ({ data }) => {
  try {
    if (data.action === "load") {
      const next: Partial<Record<GeoKind, GeoDatabase>> = {};
      const manifestResponse = await fetch(
        new URL("manifest.json", data.baseUrl),
      );
      if (!manifestResponse.ok) throw Error("Bundled Geo-IP manifest missing");
      const manifest = await manifestResponse.json();
      for (const kind of ["country", "asn"] as const) {
        self.postMessage({ progress: `Loading local ${kind} database…` });
        const entry = manifest.databases.find((d: any) => d.kind === kind);
        if (!entry || !/^[\w.-]+\.csv\.gz$/.test(entry.file))
          throw Error("Invalid Geo-IP manifest");
        const response = await fetch(new URL(entry.file, data.baseUrl));
        if (!response.ok) throw Error(`Bundled ${kind} database missing`);
        const blob = await response.blob();
        next[kind] = parseGeoCSV(
          await geoText(blob, true),
          kind,
          "DB-IP Lite",
          manifest.release,
        );
        const hash = await crypto.subtle.digest(
          "SHA-256",
          await blob.arrayBuffer(),
        );
        next[kind]!.sha256 = Array.from(new Uint8Array(hash), (x) =>
          x.toString(16).padStart(2, "0"),
        ).join("");
        if (next[kind]!.sha256 !== entry.sha256)
          throw Error("Geo-IP database checksum mismatch");
      }
      databases = next;
      custom = [];
    }
    if (data.action === "import") {
      const f: File = data.file,
        text = await geoText(f, f.name.endsWith(".gz"));
      if (f.name.endsWith(".json")) {
        custom = validateGeo(JSON.parse(text));
        databases = {};
      } else {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(data.updated))
          throw Error("Enter database release YYYY-MM");
        const d = parseGeoCSV(
          text,
          data.kind,
          "DB-IP Lite (user imported)",
          data.updated,
        );
        const hash = await crypto.subtle.digest(
          "SHA-256",
          await f.arrayBuffer(),
        );
        d.sha256 = Array.from(new Uint8Array(hash), (x) =>
          x.toString(16).padStart(2, "0"),
        ).join("");
        databases = { ...databases, [data.kind]: d };
        custom = [];
      }
    }
    const ips: string[] = [...new Set<string>(data.ips || [])];
    if (ips.length > 200000) throw Error("Too many IP lookup requests");
    const results = ips.map((ip) => {
      const row = custom.length ? lookupGeo(ip, custom) : null;
      return {
        ip,
        country:
          row?.country ??
          (databases.country ? lookupDatabase(ip, databases.country) : null),
        asn:
          row?.asn ??
          (databases.asn ? lookupDatabase(ip, databases.asn) : null),
        source:
          row?.source || (Object.keys(databases).length ? "DB-IP Lite" : null),
      };
    });
    self.postMessage({
      result: {
        results,
        databases: Object.values(databases).map((d) => ({
          kind: d.kind,
          source: d.source,
          updated: d.updated,
          license: d.license,
          sha256: d.sha256,
          ranges: d.ipv4.length + d.ipv6.length,
        })),
        customRows: custom.length,
        customProvenance: [
          ...new Map(
            custom.map((r) => [
              JSON.stringify([r.source, r.license, r.updated]),
              { source: r.source, license: r.license, updated: r.updated },
            ]),
          ).values(),
        ],
      },
    });
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
};
