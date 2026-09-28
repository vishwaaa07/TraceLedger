import { useEffect, useState } from "react";
import type { Analysis, Alert } from "./types";
export function EmbeddingMatches({
  analysis,
  txid,
  onSelect,
  rpc,
}: {
  analysis: Analysis;
  txid: string;
  onSelect: (a: Alert) => void;
  rpc: (a: string, b: any) => Promise<any>;
}) {
  const [matches, setMatches] = useState<{ txid: string; distance: number }[]>(
      [],
    ),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setMatches([]);
    setError("");
    rpc("similar", {
      txid,
      vectors: analysis.alerts.map((a) => ({
        txid: a.txid,
        vector: a.features.slice(13),
      })),
    })
      .then((r) => {
        if (active) setMatches(r);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [analysis, txid]);
  return (
    <details className="embedding-matches">
      <summary>Similar transaction structures · graph embeddings</summary>
      <p>
        A learned four-dimensional representation of this transaction and its
        earlier two-hop neighbourhood. Similarity is not a spending link or
        shared ownership.
      </p>
      {error && <p role="alert">{error}</p>}
      {matches.map((m) => (
        <button
          key={m.txid}
          onClick={() => {
            const a = analysis.alerts.find((a) => a.txid === m.txid);
            if (a) onSelect(a);
          }}
        >
          {m.txid.slice(0, 14)}… · distance {m.distance.toFixed(3)}
        </button>
      ))}
    </details>
  );
}
