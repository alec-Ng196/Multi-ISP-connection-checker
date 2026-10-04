export type TestName = 'dns' | 'ping' | 'http' | 'traceroute';

export interface TestSelection {
  local: boolean;
  remote: boolean;
  dns: boolean;
  ping: boolean;
  http: boolean;
  traceroute: boolean;
}

export interface NormalizedTarget {
  input: string;
  hostname: string;
  protocol: 'http:' | 'https:';
  port: number;
  path: string;
  url: string;
}

export interface CheckDetail {
  ok: boolean;
  summary: string;
  latencyMs?: number;
  raw?: string;
  data?: Record<string, unknown>;
}

export interface SourceResult {
  source: string;
  sourceType: 'local' | 'remote';
  location?: string;
  network?: string;
  asn?: number;
  dns?: CheckDetail;
  ping?: CheckDetail;
  http?: CheckDetail;
  tls?: CheckDetail;
  tcp?: CheckDetail;
  traceroute?: CheckDetail;
  diagnosis: string[];
}

export interface RunRequest {
  domain: string;
  networks: string[];
  selection: TestSelection;
}

export interface RunResponse {
  target: NormalizedTarget;
  startedAt: string;
  finishedAt: string;
  results: SourceResult[];
  comparison: string[];
}
