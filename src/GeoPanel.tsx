import { useEffect, useRef, useState } from "react";
import type { Analysis } from "./types";
import { download } from "./cases";
import geoManifest from "../public/geo/manifest.json";
export function GeoPanel({
  analysis,
  onResults,
}: {
  analysis: Analysis | null;
  onResults: (r: any[]) => void;
}) {
  const worker = useRef<Worker | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [ip, setIp] = useState(""),
    [kind, setKind] = useState("country"),
    [updated, setUpdated] = useState(geoManifest.release),
    [result, setResult] = useState<any>(null);
  const init = () => {
    const w = new Worker(new URL("./geo.worker.ts", import.meta.url), {
      type: "module",
    });
    w.onmessage = ({ data }) => {
      if (data.progress) {
        setMessage(data.progress);
        return;
      }
      setBusy(false);
      setMessage("");
      if (data.error) setError(data.error);
      else {
        setResult(data.result);
        onResults(data.result.results);
      }
    };
    w.onerror = () => {
      setBusy(false);
      setError("Geo-IP worker failed. Clear and reload the database.");
    };
    worker.current = w;
  };
  useEffect(() => {
    init();
    return () => worker.current?.terminate();
  }, []);
  useEffect(() => {
    setResult(null);
    onResults([]);
  }, [analysis?.dataset.hash]);
  const run = (action: string, extra: object = {}) => {
    setBusy(true);
    setError("");
    worker.current?.postMessage({
      action,
      baseUrl: new URL("./geo/", document.baseURI).href,
      ips: ip.trim()
        ? [ip.trim()]
        : [
            ...new Set(
              (analysis?.dataset.observations || []).flatMap((o) => [
                o.src_ip,
                o.dst_ip,
              ]),
            ),
          ],
      ...extra,
    });
  };
  return (
    <section className="panel">
      <h2>Local Geo-IP database</h2>
      <p>
        Country and ASN lookups run on this computer. Location is approximate;
        it does not identify a person.
      </p>
      <div className="toolbar">
        <button className="primary" disabled={busy} onClick={() => run("load")}>
          Load bundled Geo-IP databases
        </button>
        <button
          onClick={() => {
            worker.current?.terminate();
            init();
            setResult(null);
            onResults([]);
            setBusy(false);
            setMessage("");
            setError("");
          }}
        >
          Clear / cancel Geo-IP
        </button>
      </div>
      <p>
        <a href="https://db-ip.com" target="_blank" rel="noreferrer">
          IP Geolocation by DB-IP
        </a>{" "}
        · {geoManifest.release} · CC BY 4.0 · IPv4 + IPv6
      </p>
      {busy && (
        <p role="status">{message || "Indexing and looking up addresses…"}</p>
      )}
      {error && <p role="alert">{error}</p>}
      <details>
        <summary>Update or import a database</summary>
        <p>
          Choose DB-IP Lite CSV / CSV.gz, or a documented custom CIDR JSON
          table. Updates are local; no automatic downloads.
        </p>
        <label>
          Database type{" "}
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="country">Country</option>
            <option value="asn">ASN</option>
          </select>
        </label>
        <label>
          Release month{" "}
          <input
            aria-label="Geo-IP release"
            value={updated}
            onChange={(e) => setUpdated(e.target.value)}
          />
        </label>
        <input
          aria-label="Import Geo-IP"
          disabled={busy}
          type="file"
          accept=".json,.csv,.gz"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) run("import", { file, kind, updated });
          }}
        />
      </details>
      <div className="toolbar">
        <label>
          IP lookup{" "}
          <input
            aria-label="IP lookup"
            placeholder="IP address, or leave blank for case peers"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
          />
        </label>
        <button disabled={busy} onClick={() => run("lookup")}>
          Look up IPs
        </button>
      </div>
      {!result?.databases.length && !result?.customRows && (
        <p>Geo-IP unavailable</p>
      )}
      {result && (
        <>
          <p>
            {result.databases
              .map(
                (d: any) =>
                  `${d.kind}: ${d.ranges.toLocaleString()} ranges (${d.updated})`,
              )
              .join(" · ")}
            {result.customRows ? `${result.customRows} custom ranges` : ""}
          </p>
          <p>
            {result.results.filter((r: any) => r.country || r.asn).length}{" "}
            matched / {result.results.length} IPs. Documentation and private
            addresses have no public location.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>IP</th>
                  <th>Country</th>
                  <th>ASN</th>
                </tr>
              </thead>
              <tbody>
                {result.results.slice(0, 100).map((r: any) => (
                  <tr key={r.ip}>
                    <td>{r.ip}</td>
                    <td>{r.country || "Unavailable"}</td>
                    <td>{r.asn ? `AS${r.asn}` : "Unavailable"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.results.length > 100 && (
            <p>Showing the first 100 IPs; export includes all results.</p>
          )}
          <button
            onClick={() =>
              download(
                "geo-evidence.json",
                JSON.stringify(
                  {
                    dataset: analysis?.dataset.hash,
                    model: analysis?.modelVersion,
                    ...result,
                    limitations:
                      "Approximate network location, not identity. Session-local enrichment; original observations are unchanged.",
                  },
                  null,
                  2,
                ),
              )
            }
          >
            Export Geo-IP evidence
          </button>
        </>
      )}
    </section>
  );
}
