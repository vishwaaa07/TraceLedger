import { useMemo } from "react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { Analysis, Alert } from "./types";

export function TransactionTimeline({ analysis }: { analysis: Analysis }) {
  const points = useMemo(() => {
    const counts = new Map<number, number>();
    for (const tx of analysis.dataset.transactions) {
      const day = Math.floor(Date.parse(tx.timestamp) / 86400000) * 86400000;
      counts.set(day, (counts.get(day) || 0) + 1);
    }
    const days = [...counts.keys()].sort((a, b) => a - b);
    if (!days.length) return [];
    // Bound chart bins even when an imported dataset spans many years.
    const step =
      Math.max(1, Math.ceil((days.at(-1)! - days[0]) / 86400000 / 180)) *
      86400000;
    const bins = Array.from(
      { length: Math.floor((days.at(-1)! - days[0]) / step) + 1 },
      (_, i) => ({ time: days[0] + i * step, count: 0 }),
    );
    for (const [day, count] of counts)
      bins[Math.floor((day - days[0]) / step)].count += count;
    return bins;
  }, [analysis.dataset]);
  return (
    <section className="panel timeline">
      <div className="panel-heading">
        <h2>Bitcoin transaction volume</h2>
        <span className="badge">Loaded dataset · not live</span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={points}>
          <defs>
            <linearGradient id="volumeWave" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#9562ee" stopOpacity={0.55} />
              <stop offset="100%" stopColor="#9562ee" stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#8792a333" />
          <XAxis
            dataKey="time"
            tickFormatter={(v) => new Date(v).toISOString().slice(5, 10)}
            minTickGap={35}
          />
          <YAxis allowDecimals={false} width={35} />
          <Tooltip
            labelFormatter={(v) =>
              new Date(Number(v)).toISOString().slice(0, 10)
            }
            contentStyle={{
              background: "var(--surface)",
              color: "var(--ink)",
              borderColor: "var(--line)",
            }}
          />
          <Area
            type="monotone"
            dataKey="count"
            name="Unique transactions"
            stroke="#9562ee"
            strokeWidth={2.5}
            fill="url(#volumeWave)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      <small>
        Unique transactions per UTC time bin. Hover for counts; the smooth line
        connects measured bins.
      </small>
    </section>
  );
}

export function TransactionConnections({
  analysis,
  txid,
  onSelect,
}: {
  analysis: Analysis;
  txid: string;
  onSelect: (a: Alert) => void;
}) {
  const tx = analysis.dataset.transactions.find((t) => t.txid === txid);
  const edges = analysis.elements.filter(
    (e) =>
      e.data.type === "spend" &&
      (e.data.source === "t:" + txid || e.data.target === "t:" + txid),
  );
  const ids = [
    ...new Set(
      edges.map((e) =>
        String(
          e.data.source === "t:" + txid ? e.data.target : e.data.source,
        ).slice(2),
      ),
    ),
  ];
  return (
    <section className="entity-connections">
      <h3>Transaction details</h3>
      <div className="entity-facts">
        <span>{tx?.inputs.length ?? 0} inputs</span>
        <span>{tx?.outputs.length ?? 0} outputs</span>
        <span>
          Fee:{" "}
          {tx?.fees == null ? "Unknown" : tx.fees.toLocaleString() + " sats"}
        </span>
        <span>{tx?.script_type}</span>
      </div>
      <h3>
        Connected transactions <small>Recorded output spends only</small>
      </h3>
      {ids.length ? (
        <div className="connection-list">
          {ids.map((id) => {
            const alert = analysis.alerts.find((a) => a.txid === id);
            const incoming = edges.some((e) => e.data.source === "t:" + id);
            return (
              <button
                key={id}
                disabled={!alert}
                onClick={() => alert && onSelect(alert)}
              >
                <span>
                  {incoming ? "← Previous transaction" : "Next transaction →"}
                </span>
                <code>{id.slice(0, 14)}…</code>
                <small>
                  Model percentile:{" "}
                  {alert?.percentile.toFixed(1) ?? "Unavailable"}
                </small>
              </button>
            );
          })}
        </div>
      ) : (
        <p>No linked transactions are available in this dataset.</p>
      )}
    </section>
  );
}

export function LinuxSetup() {
  return (
    <section className="panel linux-setup">
      <h2>Download and run on Linux</h2>
      <h3>1. Install prerequisites while online</h3>
      <p>
        You need Python 3.10 or newer, a browser, and unzip for the ZIP package.
        On Ubuntu or Debian:
      </p>
      <pre>{`sudo apt update\nsudo apt install python3 unzip firefox\npython3 --version`}</pre>
      <p>
        For other distributions, install these packages with your distribution's
        package manager. The built app does not need Node.js or Python training
        packages.
      </p>
      <h3>2. Copy the package to Downloads</h3>
      <p>
        Download the supplied <code>ltraceledger.zip</code> from your shared
        project files, or copy it from a USB drive. There is no public download
        site. Extract the entire archive:
      </p>
      <pre>{`cd ~/Downloads\nunzip ltraceledger.zip\ncd ltraceledger\nls serve.py dist/index.html`}</pre>
      <h3>3. Start the local server</h3>
      <pre>python3 serve.py</pre>
      <p>
        Open <a href="http://127.0.0.1:4173">http://127.0.0.1:4173</a> in your
        browser. Keep the terminal open. Do not open index.html directly. Choose{" "}
        <strong>Explore sample investigation</strong>, or import, validate and
        run analysis on your data.
      </p>
      <h3>4. Run offline and save your work</h3>
      <p>
        Once the package and prerequisites are installed, disconnect from the
        internet and start the same command. Save your case in Investigations
        and export a JSON backup. Press Ctrl+C in the terminal to stop.
      </p>
      <h3>If something does not open</h3>
      <ul>
        <li>
          <strong>Port already in use:</strong> run{" "}
          <code>python3 serve.py --port 4180</code> and open
          http://127.0.0.1:4180.
        </li>
        <li>
          <strong>File not found:</strong> check that you are inside the
          extracted ltraceledger folder.
        </li>
        <li>
          <strong>Missing model or blank page:</strong> extract the whole ZIP
          again and use the HTTP address above.
        </li>
        <li>
          <strong>Saved case missing:</strong> use the same browser and port, or
          import your exported case JSON.
        </li>
      </ul>
      <p className="muted">
        For the separate offline tar package:{" "}
        <code>tar -xzf trace-ledger-offline.tar.gz</code>, then{" "}
        <code>cd trace-ledger-offline</code> and run the same Python command.
      </p>
    </section>
  );
}
