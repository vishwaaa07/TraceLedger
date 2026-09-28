import Papa from "papaparse";
import ipaddr from "ipaddr.js";
export type GeoKind = "country" | "asn";
type Range = { start: bigint; end: bigint; value: string };
export type GeoDatabase = {
  kind: GeoKind;
  ipv4: Range[];
  ipv6: Range[];
  source: string;
  updated: string;
  license: string;
  sha256?: string;
};
function numeric(ip: string) {
  const a = ipaddr.parse(ip);
  return {
    family: a.kind(),
    value: a.toByteArray().reduce((n, b) => (n << 8n) + BigInt(b), 0n),
  };
}
export function parseGeoCSV(
  text: string,
  kind: GeoKind,
  source: string,
  updated: string,
): GeoDatabase {
  if (new TextEncoder().encode(text).length > 100 * 1024 * 1024)
    throw Error("Expanded Geo-IP file exceeds 100 MiB");
  const d: GeoDatabase = {
    kind,
    ipv4: [],
    ipv6: [],
    source,
    updated,
    license: "CC BY 4.0 (DB-IP Lite)",
  };
  let count = 0;
  Papa.parse<string[]>(text, {
    skipEmptyLines: true,
    step(r) {
      if (r.errors.length) throw Error("Invalid Geo-IP CSV");
      if (++count > 2000000)
        throw Error("Geo-IP database exceeds 2 million ranges");
      const row = r.data;
      if (row.length < (kind === "asn" ? 4 : 3))
        throw Error("Expected DB-IP Lite range CSV");
      const start = numeric(row[0]),
        end = numeric(row[1]),
        v = row[2];
      if (start.family !== end.family || start.value > end.value)
        throw Error("Invalid Geo-IP range");
      if (
        kind === "country"
          ? !/^[A-Z]{2}$/.test(v)
          : !/^\d+$/.test(v) || Number(v) > 4294967295
      )
        throw Error("Invalid country / ASN");
      d[start.family].push({ start: start.value, end: end.value, value: v });
    },
  });
  for (const ranges of [d.ipv4, d.ipv6]) {
    ranges.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    for (let i = 1; i < ranges.length; i++)
      if (ranges[i].start <= ranges[i - 1].end)
        throw Error("Overlapping Geo-IP ranges");
  }
  if (!count) throw Error("Empty Geo-IP database");
  return d;
}
export function lookupDatabase(ip: string, d: GeoDatabase): string | null {
  try {
    // Never geolocate documentation/private addresses, even if a database covers them.
    const a = ipaddr.process(ip);
    if (a.range() !== "unicast") return null;
    const { family, value } = numeric(a.toString()),
      ranges = d[family];
    let lo = 0,
      hi = ranges.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (ranges[mid].start <= value) lo = mid + 1;
      else hi = mid;
    }
    const r = ranges[lo - 1];
    return r && value <= r.end && r.value !== "ZZ" && r.value !== "0"
      ? r.value
      : null;
  } catch {
    return null;
  }
}
export async function geoText(blob: Blob, gzip: boolean): Promise<string> {
  if (blob.size > 100 * 1024 * 1024) throw Error("Geo-IP file exceeds 100 MiB");
  const stream = gzip
    ? blob.stream().pipeThrough(new DecompressionStream("gzip"))
    : blob.stream();
  const reader = stream.getReader(),
    decoder = new TextDecoder();
  let total = 0,
    text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 100 * 1024 * 1024)
        throw Error("Expanded Geo-IP file exceeds 100 MiB");
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel();
  }
}
