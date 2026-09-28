export type Input = {
  address: string;
  amount: number;
  prev_txid?: string;
  prev_index?: number;
};
export type Output = { address: string; amount: number; index: number };
export type Tx = {
  txid: string;
  timestamp: string;
  inputs: Input[];
  outputs: Output[];
  fees: number | null;
  script_type: string;
  funding_boundary: boolean;
  synthetic: boolean;
  provenance: Record<string, string>;
  source: Record<string, unknown>;
};
export type Observation = {
  id: string;
  txid: string;
  timestamp: string;
  src_ip: string;
  dst_ip: string;
  src_port: number;
  dst_port: number;
  observer_id?: string;
  geo_country?: string;
  asn?: number;
  geo_provenance?: string;
};
export type Issue = {
  row: number;
  severity: "error" | "warning";
  field: string;
  message: string;
};
export type Dataset = {
  transactions: Tx[];
  observations: Observation[];
  issues: Issue[];
  rows: number;
  rejected: number;
  hash: string;
  synthetic: boolean;
  columns: string[];
};
export type Tree = {
  left: number[];
  right: number[];
  feature: number[];
  threshold: number[];
  samples: number[];
};
export type Model = {
  embedding: {
    method: string;
    dimensions: number;
    mean: number[];
    scale: number[];
    pca_mean: number[];
    components: number[][];
    explained_variance_ratio: number[];
  };
  selected_representation: string;
  threshold_method: string;
  version: string;
  schema_version: number;
  features: string[];
  trees: Tree[];
  max_samples: number;
  calibration_scores: number[];
  alert_threshold: number;
  reference: Record<string, { median: number; p05: number; p95: number }>;
};
export type Element = {
  data: {
    id: string;
    label?: string;
    type: string;
    source?: string;
    target?: string;
    timestamp?: string;
    [key: string]: unknown;
  };
};
export type Alert = {
  txid: string;
  category: string;
  score: number;
  percentile: number;
  features: number[];
  quality: number;
  support: string[];
  timestamp: string;
};
export type Exposure = {
  txid: string;
  score: number;
  distance: number;
  path: string[];
  seed: string;
  provenance: string;
};
export type Analysis = {
  dataset: Dataset;
  modelVersion: string;
  alerts: Alert[];
  elements: Element[];
  clusters: { id: string; addresses: string[]; transactions: string[] }[];
  exposure: Exposure[];
  elapsedMs: number;
  settings: {
    threshold: number;
    seed: string;
    provenance: string;
    maxHops: number;
    decay: number;
  };
  totalOutputSats: string;
  totalFeeSats: string;
};
