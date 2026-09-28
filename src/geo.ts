import ipaddr from "ipaddr.js";
export type GeoRow = {
  cidr: string;
  country: string;
  asn: number;
  source: string;
  license: string;
  updated: string;
};
export function validateGeo(rows: unknown): GeoRow[] {
  if (!Array.isArray(rows) || rows.length > 100000)
    throw Error("Geo table must be an array, at most 100,000 rows");
  for (const r of rows) {
    try {
      ipaddr.parseCIDR(r.cidr);
    } catch {
      throw Error("Invalid Geo-IP CIDR");
    }
    if (
      !/^[A-Z]{2}$/.test(r.country) ||
      !Number.isSafeInteger(r.asn) ||
      r.asn < 0 ||
      !r.source ||
      !r.license ||
      !r.updated
    )
      throw Error("Country, ASN, source, license and updated required");
  }
  return rows;
}
export function lookupGeo(ip: string, rows: GeoRow[]) {
  if (!ipaddr.isValid(ip)) return null;
  const addr = ipaddr.parse(ip);
  return (
    rows
      .filter((r) => {
        const [net, prefix] = ipaddr.parseCIDR(r.cidr);
        return net.kind() === addr.kind() && addr.match(net, prefix);
      })
      .sort(
        (a, b) => Number(b.cidr.split("/")[1]) - Number(a.cidr.split("/")[1]),
      )[0] ?? null
  );
}
