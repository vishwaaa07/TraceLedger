import Papa from "papaparse";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import ipaddr from "ipaddr.js";
import type { Dataset, Tx, Observation, Issue, Input, Output } from "./types";
export const MAX_BYTES = 50 * 1024 * 1024,
  MAX_RECORDS = 50000;
const txidRe = /^[a-fA-F0-9]{64}$/;
function array(x: unknown): any[] {
  const v = typeof x === "string" ? JSON.parse(x) : x;
  if (!Array.isArray(v)) throw Error("Expected JSON array");
  return v;
}
function sats(x: unknown): number {
  if (x === "" || x == null || typeof x === "boolean")
    throw Error("Missing integer satoshis");
  const n = Number(x);
  if (!Number.isSafeInteger(n) || n < 0)
    throw Error("Expected nonnegative safe-integer satoshis");
  return n;
}
function sum(a: number[]) {
  const v = a.reduce((s, x) => s + BigInt(x), 0n);
  if (v > BigInt(Number.MAX_SAFE_INTEGER))
    throw Error("Transaction sum exceeds safe integer");
  return Number(v);
}
function time(x: unknown) {
  if (
    typeof x !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(x) ||
    !Number.isFinite(Date.parse(x))
  )
    throw Error("ISO-8601 timestamp with explicit timezone required");
  const date = x.slice(0, 10);
  if (new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date)
    throw Error("Invalid calendar date");
  return new Date(x).toISOString();
}
function address(x: unknown) {
  if (typeof x !== "string" || !x.trim() || x.length > 200)
    throw Error("Invalid address identifier (1–200 characters)");
  return x;
}
const bool = (v: unknown) => v === true || v === "true";
export function parseRows(text: string, format: string): Record<string, any>[] {
  if (new TextEncoder().encode(text).length > MAX_BYTES)
    throw Error("File exceeds 50 MiB limit");
  let rows: any;
  if (format === "csv") {
    const p = Papa.parse<Record<string, any>>(text, {
      header: true,
      skipEmptyLines: "greedy",
    });
    if (p.errors.length) throw Error("CSV: " + p.errors[0].message);
    rows = p.data;
  } else if (format === "xml") {
    if (/<!\s*(DOCTYPE|ENTITY)/i.test(text))
      throw Error("Unsafe XML: DTD and entity declarations prohibited");
    if (XMLValidator.validate(text) !== true) throw Error("Malformed XML");
    const parsed = new XMLParser({
      parseTagValue: false,
      ignoreAttributes: true,
    }).parse(text);
    rows = parsed.records?.record;
    rows = rows == null ? [] : Array.isArray(rows) ? rows : [rows];
  } else if (format === "json") {
    rows = JSON.parse(text);
    if (!Array.isArray(rows)) rows = rows.records;
  } else throw Error("Choose CSV, JSON or XML");
  if (!Array.isArray(rows) || !rows.length) throw Error("No records found");
  if (rows.length > MAX_RECORDS) throw Error("Record limit: 50,000");
  if (rows.some((r) => !r || typeof r !== "object" || Array.isArray(r)))
    throw Error("Each record must be an object");
  return rows;
}
export async function ingest(
  text: string,
  format: string,
  mapping: Record<string, string> = {},
  onProgress?: (done: number, total: number) => void,
): Promise<Dataset> {
  const rows = parseRows(text, format),
    issues: Issue[] = [],
    txs = new Map<string, Tx>(),
    observations = new Map<string, Observation>(),
    conflicts = new Set<string>(),
    rejectedRows = new Set<number>();
  const warn = (row: number, field: string, message: string) =>
    issues.push({ row, severity: "warning", field, message });
  const error = (row: number, field: string, message: string) => {
    issues.push({ row, severity: "error", field, message });
    rejectedRows.add(row);
  };
  const rowByTx = new Map<string, number[]>();
  rows.forEach((original, idx) => {
    if (idx % 1000 === 0) onProgress?.(idx, rows.length);
    const row = idx + 1,
      r = { ...original };
    for (const [expected, column] of Object.entries(mapping)) {
      if (column) r[expected] = original[column];
      else delete r[expected];
    }
    try {
      if (!txidRe.test(r.txid))
        throw Error("TXID must be 64 hexadecimal characters");
      r.txid = r.txid.toLowerCase();
      const timestamp = time(r.timestamp);
      let inputs: Input[], outputs: Output[];
      if (r.inputs !== undefined && r.inputs !== "")
        inputs = array(r.inputs).map((i) => ({
          address: address(i.address),
          amount: sats(i.amount),
          ...(i.prev_txid !== undefined
            ? {
                prev_txid: String(i.prev_txid).toLowerCase(),
                prev_index: sats(i.prev_index),
              }
            : {}),
        }));
      else {
        const aa = array(r.input_addresses),
          am = array(r.input_amounts);
        if (aa.length !== am.length) throw Error("Input array lengths differ");
        inputs = aa.map((a, i) => ({
          address: address(a),
          amount: sats(am[i]),
        }));
      }
      if (r.outputs !== undefined && r.outputs !== "")
        outputs = array(r.outputs).map((o) => ({
          address: address(o.address),
          amount: sats(o.amount),
          index: sats(o.index),
        }));
      else {
        const aa = array(r.output_addresses),
          am = array(r.output_amounts);
        if (aa.length !== am.length) throw Error("Output array lengths differ");
        outputs = aa.map((a, i) => ({
          address: address(a),
          amount: sats(am[i]),
          index: i,
        }));
      }
      if (
        !outputs.length ||
        new Set(outputs.map((o) => o.index)).size !== outputs.length
      )
        throw Error("Outputs required with unique indices");
      for (const i of inputs)
        if (i.prev_txid && !txidRe.test(i.prev_txid))
          throw Error("Invalid previous TXID");
      // If both PS arrays and enriched objects exist, neither may silently override conflicting data.
      for (const [field, expected] of Object.entries({
        input_addresses: inputs.map((i) => i.address),
        input_amounts: inputs.map((i) => i.amount),
        output_addresses: outputs.map((o) => o.address),
        output_amounts: outputs.map((o) => o.amount),
      }))
        if (
          r[field] !== undefined &&
          r[field] !== "" &&
          JSON.stringify(array(r[field])) !== JSON.stringify(expected)
        )
          throw Error(
            "Conflicting " + field + " and structured inputs/outputs",
          );
      const fees = r.fees == null || r.fees === "" ? null : sats(r.fees),
        boundary = bool(r.funding_boundary);
      const totalIn = sum(inputs.map((i) => i.amount)),
        totalOut = sum(outputs.map((o) => o.amount));
      if (inputs.length && totalOut > totalIn)
        throw Error("Outputs exceed inputs");
      if (
        inputs.length &&
        fees !== null &&
        BigInt(totalIn) !== BigInt(totalOut) + BigInt(fees)
      )
        throw Error("Inputs must equal outputs plus fee");
      if (!inputs.length && !boundary)
        warn(
          row,
          "inputs",
          "No inputs: external funding unknown; accounting unavailable",
        );
      if (fees === null)
        warn(
          row,
          "fees",
          "Fee unavailable; model uses zero placeholder with reduced evidence quality",
        );
      if (inputs.some((i) => !i.prev_txid))
        warn(
          row,
          "inputs",
          "Missing UTXO references; exact spending links unavailable",
        );
      const tx: Tx = {
        txid: r.txid,
        timestamp,
        inputs,
        outputs,
        fees,
        script_type: String(r.script_type || "unknown"),
        funding_boundary: boundary,
        synthetic: bool(r.synthetic),
        provenance: {
          timestamp: "supplied transaction time",
          inputs: r.inputs
            ? "supplied objects"
            : "supplied arrays; UTXO references unavailable",
          outputs: r.outputs
            ? "supplied objects"
            : "supplied arrays; index derived from position",
          fees: fees === null ? "unavailable" : "supplied",
        },
        source: original,
      };
      const signature = (t: Tx) =>
        JSON.stringify([
          t.timestamp,
          t.inputs,
          t.outputs,
          t.fees,
          t.script_type,
          t.funding_boundary,
          t.synthetic,
        ]);
      const previous = txs.get(tx.txid);
      rowByTx.set(tx.txid, [...(rowByTx.get(tx.txid) || []), row]);
      if (previous && signature(previous) !== signature(tx)) {
        conflicts.add(tx.txid);
        throw Error("Conflicting transaction records for same TXID");
      }
      if (!previous) txs.set(tx.txid, tx);
      if (!r.observation_id) {
        warn(row, "network", "Network observation unavailable");
        return;
      }
      try {
        if (
          !r.src_ip ||
          !r.dst_ip ||
          !ipaddr.isValid(r.src_ip) ||
          !ipaddr.isValid(r.dst_ip)
        )
          throw Error("Invalid IP syntax");
        const port = (v: unknown) => {
          const p = sats(v);
          if (p < 1 || p > 65535) throw Error("Port must be 1–65535");
          return p;
        };
        const ob: Observation = {
          id: String(r.observation_id),
          txid: tx.txid,
          timestamp: time(r.observation_timestamp),
          src_ip: r.src_ip,
          dst_ip: r.dst_ip,
          src_port: port(r.src_port),
          dst_port: port(r.dst_port),
          observer_id: r.observer_id || undefined,
          geo_country: r.geo_country || undefined,
          asn: r.asn == null || r.asn === "" ? undefined : sats(r.asn),
          geo_provenance: r.geo_provenance || "supplied, unverified",
        };
        if (ob.timestamp < tx.timestamp)
          warn(
            row,
            "observation_timestamp",
            "Observation precedes supplied transaction time; check clock semantics",
          );
        if (ob.id.length > 200) throw Error("Observation ID too long");
        if (observations.has(ob.id)) {
          if (JSON.stringify(observations.get(ob.id)) !== JSON.stringify(ob))
            throw Error("Conflicting observation ID");
          warn(row, "observation_id", "Duplicate observation ignored");
        } else observations.set(ob.id, ob);
      } catch (e) {
        warn(
          row,
          "network",
          String(e) + "; transaction retained, observation excluded",
        );
      }
    } catch (e) {
      error(row, "record", String(e));
    }
  });
  for (const id of conflicts) {
    txs.delete(id);
    for (const row of rowByTx.get(id) || [])
      error(row, "txid", "Conflicting TXID excluded entirely");
  }
  const spends = new Map<string, string>(),
    invalid = new Set<string>();
  for (const tx of [...txs.values()].sort(
    (a, b) =>
      a.timestamp.localeCompare(b.timestamp) || a.txid.localeCompare(b.txid),
  )) {
    for (const i of tx.inputs) {
      if (!i.prev_txid) continue;
      const key = i.prev_txid + ":" + i.prev_index,
        parent = txs.get(i.prev_txid),
        row = rowByTx.get(tx.txid)![0];
      if (spends.has(key)) {
        error(row, "inputs", "Double spend of " + key);
        invalid.add(tx.txid);
      } else spends.set(key, tx.txid);
      if (!parent) {
        warn(
          row,
          "inputs",
          "Referenced transaction unavailable: " + i.prev_txid,
        );
        continue;
      }
      const o = parent.outputs.find((o) => o.index === i.prev_index);
      if (
        !o ||
        o.amount !== i.amount ||
        o.address !== i.address ||
        parent.timestamp >= tx.timestamp
      ) {
        error(row, "inputs", "UTXO value/address/index or chronology mismatch");
        invalid.add(tx.txid);
      }
    }
  }
  // Remove descendants of invalid data rather than fabricating a valid chain.
  let changed = true;
  while (changed) {
    changed = false;
    for (const tx of txs.values())
      if (
        !invalid.has(tx.txid) &&
        tx.inputs.some((i) => i.prev_txid && invalid.has(i.prev_txid))
      ) {
        invalid.add(tx.txid);
        changed = true;
      }
  }
  for (const id of invalid) {
    txs.delete(id);
    for (const row of rowByTx.get(id) || [])
      error(row, "inputs", "Invalid spend or dependency excluded");
  }
  const transactions = [...txs.values()].sort(
    (a, b) =>
      a.timestamp.localeCompare(b.timestamp) || a.txid.localeCompare(b.txid),
  );
  const obs = [...observations.values()].filter((o) => txs.has(o.txid));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return {
    transactions,
    observations: obs,
    issues,
    rows: rows.length,
    rejected: rejectedRows.size,
    hash: [...new Uint8Array(digest)]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join(""),
    synthetic:
      transactions.length > 0 && transactions.every((t) => t.synthetic),
    columns: Object.keys(rows[0]),
  };
}
