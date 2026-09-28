import type { Alert, Analysis } from "./types";

export function AnalystSummary({ alert, analysis }: { alert: Alert; analysis: Analysis }) {
  const flagged = alert.score >= analysis.settings.threshold;
  const tx = analysis.dataset.transactions.find(t => t.txid === alert.txid);
  const observed = analysis.dataset.observations.some(o => o.txid === alert.txid);
  const parents = new Set(tx?.inputs.flatMap(i => i.prev_txid ? [i.prev_txid] : []));
  return <section className="analyst-summary" aria-label="Automatic analyst summary">
    <div className="panel-heading"><h3>Analyst summary</h3><span className="badge">Model-assisted review</span></div>
    <p>{flagged ? "Prioritise this transaction for review." : "The anomaly model does not flag this transaction at the current threshold."} Its score is at the {alert.percentile.toFixed(1)}th percentile of the calibration data.</p>
    <div className="summary-columns">
      <div><h4>What stands out</h4><ul>{alert.support.map(s => <li key={s}>{s}</li>)}</ul></div>
      <div><h4>Suggested checks</h4><ul>
        <li>{parents.size ? `Inspect the ${parents.size} referenced previous transaction${parents.size === 1 ? "" : "s"} and follow the recorded output spends.` : "Check the funding boundary and any missing previous-output references."}</li>
        {alert.category.includes("CoinJoin") && <li>Check for collaborative payment activity before using common-input ownership assumptions.</li>}
        <li>{observed ? "Compare relay timestamps with transaction time; relay IPs do not identify the sender." : "Network evidence is missing. Obtain observations before drawing relay conclusions."}</li>
        {alert.quality < 100 && <li>Resolve missing fields before deciding whether to escalate this lead.</li>}
      </ul></div>
    </div>
    <small>Generated from the fitted model’s score and recorded evidence. Suggested checks use fixed guidance rules; Isolation Forest does not write advice or determine wrongdoing.</small>
  </section>;
}
