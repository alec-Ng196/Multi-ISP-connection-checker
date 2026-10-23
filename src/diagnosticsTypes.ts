export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS' | 'SOA' | 'CAA' | 'SRV';
export interface DnsOptions { types: DnsRecordType[]; resolver?: string; timeoutMs: number; followCname: boolean; }
export interface DnsRecord { name: string; type: string; value: string; ttl?: number; details?: Record<string, unknown>; }
export interface DnsQueryResult { name: string; type: string; status: 'ok' | 'no-data' | 'not-found' | 'error' | 'timeout' | 'cancelled'; durationMs: number; records: DnsRecord[]; error?: string; }
export interface DnsReport { hostname: string; resolvers: string[]; queries: DnsQueryResult[]; cnameChain: string[]; warnings: string[]; }
export type HttpStage = 'dns' | 'tcp' | 'tls' | 'upload' | 'headers' | 'body';
export interface HttpTimeouts { dnsMs: number; connectMs: number; tlsMs: number; headersMs: number; bodyIdleMs: number; totalMs: number; }
export interface HttpOptions { method: string; headers: Record<string, string>; body: string; samples: number; intervalMs: number; timeouts: HttpTimeouts; maxBytes: number; originIp?: string; originPort?: number; }
export interface StageTiming { stage: HttpStage; startMs: number; durationMs: number; completed: boolean; }
export interface HttpSample { index: number; route: 'public' | 'origin'; requestId: string; startedAt: string; outcome: 'complete' | 'timeout' | 'error' | 'cancelled' | 'limit'; statusCode?: number; error?: string; failedStage?: HttpStage; timeoutKind?: string; totalMs: number; headersMs?: number; bytes: number; remoteAddress?: string; stages: StageTiming[]; responseHeaders: Record<string, string>; tls?: Record<string, unknown>; }
export interface HttpStats { attempted: number; completed: number; timeouts: number; errors: number; cancelled: number; timeoutRate: number; httpErrorResponses: number; timeoutResponses: number; minMs?: number; maxMs?: number; meanMs?: number; p50Ms?: number; p95Ms?: number; p99Ms?: number; }
export interface HttpReport { url: string; method: string; requestedSamples: number; samples: HttpSample[]; publicStats: HttpStats; originStats?: HttpStats; warnings: string[]; }
export interface WafLogRecord { requestId: string; requestTimeMs?: number; upstreamConnectMs?: number; upstreamHeaderMs?: number; upstreamResponseMs?: number; status?: number; upstreamStatus?: number; }
export interface LogMatch { requestId: string; sampleIndex: number; route: string; records: WafLogRecord[]; }
export interface DiagnosticRun { id: string; mode: 'dns' | 'http'; startedAt: string; finishedAt: string; dns?: DnsReport; http?: HttpReport; logMatches?: LogMatch[]; logSummary?: { imported: number; matchedRecords: number; unmatchedRecords: number }; }
