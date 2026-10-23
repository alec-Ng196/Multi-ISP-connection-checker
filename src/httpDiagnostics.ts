import * as http from 'node:http';
import * as https from 'node:https';
import { isIP } from 'node:net';
import { TLSSocket, checkServerIdentity } from 'node:tls';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { NormalizedTarget } from './types';
import { HttpOptions, HttpSample, HttpStage, HttpStats, HttpReport, HttpTimeouts } from './diagnosticsTypes';

const defaults: HttpTimeouts = { dnsMs: 5000, connectMs: 8000, tlsMs: 8000, headersMs: 30000, bodyIdleMs: 10000, totalMs: 60000 };
function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function integer(value: unknown, fallback: number, min: number, max: number, name: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return value;
}
export function validateHttpOptions(input: unknown): HttpOptions {
  const raw = object(input ?? {}, 'HTTP options');
  const method = raw.method === undefined ? 'GET' : raw.method;
  if (typeof method !== 'string' || !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method)) throw new Error('Unsupported HTTP method');
  const headers: Record<string, string> = Object.create(null);
  const supplied = raw.headers === undefined ? {} : object(raw.headers, 'Headers');
  let headerBytes = 0;
  for (const [name, value] of Object.entries(supplied)) {
    if (typeof value !== 'string') throw new Error('Header values must be strings');
    http.validateHeaderName(name); http.validateHeaderValue(name, value);
    const key = name.toLowerCase();
    if (['host', 'content-length', 'connection', 'transfer-encoding', 'x-diagnostic-request-id', 'expect', 'upgrade', 'trailer'].includes(key)) throw new Error(`Header ${name} is managed by the diagnostic client`);
    if (key in headers) throw new Error('Duplicate header name');
    headerBytes += Buffer.byteLength(name + value);
    if (headerBytes > 16384 || Object.keys(headers).length >= 64) throw new Error('Request headers exceed the limit');
    headers[key] = value;
  }
  const body = raw.body === undefined ? '' : raw.body;
  if (typeof body !== 'string' || Buffer.byteLength(body) > 65536) throw new Error('Request body must be a string of at most 64 KiB');
  if (body && ['GET', 'HEAD'].includes(method)) throw new Error('GET and HEAD cannot include a request body');
  const timeouts = { ...defaults };
  const suppliedTimeouts = raw.timeouts === undefined ? {} : object(raw.timeouts, 'Timeouts');
  for (const key of Object.keys(defaults) as (keyof HttpTimeouts)[]) timeouts[key] = integer(suppliedTimeouts[key], defaults[key], 100, 300000, key);
  let originIp: string | undefined;
  if (raw.originIp !== undefined && raw.originIp !== '') {
    if (typeof raw.originIp !== 'string' || !isIP(raw.originIp)) throw new Error('Origin must be a literal IPv4 or IPv6 address');
    originIp = raw.originIp;
  }
  const originPort = raw.originPort === undefined ? undefined : integer(raw.originPort, 443, 1, 65535, 'Origin port');
  if (originPort !== undefined && !originIp) throw new Error('Origin port requires an origin IP');
  return { method, headers, body, timeouts, originIp, originPort,
    samples: integer(raw.samples, 3, 1, 50, 'Samples'), intervalMs: integer(raw.intervalMs, 500, 100, 60000, 'Interval'),
    maxBytes: integer(raw.maxBytes, 2 * 1024 * 1024, 1024, 10 * 1024 * 1024, 'Response byte limit') };
}

const responseWhitelist = new Set(['content-type', 'content-length', 'content-encoding', 'location', 'server', 'date', 'via', 'retry-after', 'server-timing', 'x-request-id', 'x-correlation-id', 'x-diagnostic-request-id', 'cf-ray', 'x-cache']);

/** Each sample uses a new socket. Timings describe event boundaries, not packet capture. */
export function measureHttp(target: NormalizedTarget, options: HttpOptions, route: 'public' | 'origin', index: number, signal?: AbortSignal): Promise<HttpSample> {
  return new Promise(resolve => {
    const start = performance.now();
    const sample: HttpSample = { index, route, requestId: randomUUID(), startedAt: new Date().toISOString(), outcome: 'error', totalMs: 0, bytes: 0, stages: [], responseHeaders: {} };
    let req: http.ClientRequest | undefined;
    let res: http.IncomingMessage | undefined;
    let done = false;
    let stage: HttpStage | undefined;
    let stageTimer: ReturnType<typeof setTimeout> | undefined;
    let totalTimer: ReturnType<typeof setTimeout> | undefined;
    let ready = false;
    let uploaded = false;
    const elapsed = () => performance.now() - start;
    const closeStage = (completed: boolean) => {
      const timing = sample.stages.at(-1);
      if (timing && !timing.completed) { timing.durationMs = elapsed() - timing.startMs; timing.completed = completed; }
    };
    const finish = (outcome: HttpSample['outcome'], error?: string, timeoutKind?: string) => {
      if (done) return;
      done = true;
      closeStage(outcome === 'complete');
      sample.outcome = outcome; sample.totalMs = elapsed();
      if (outcome !== 'complete') sample.failedStage = stage;
      if (error) sample.error = error;
      if (timeoutKind) sample.timeoutKind = timeoutKind;
      clearTimeout(stageTimer); clearTimeout(totalTimer);
      signal?.removeEventListener('abort', abort);
      res?.destroy(); req?.destroy();
      resolve(sample);
    };
    const arm = (ms: number, kind: string) => {
      clearTimeout(stageTimer);
      stageTimer = setTimeout(() => finish('timeout', `${kind} deadline exceeded`, kind), ms);
    };
    const enter = (next: HttpStage, timeout?: number, kind: string = next) => {
      if (done) return;
      closeStage(true); clearTimeout(stageTimer); stage = next;
      sample.stages.push({ stage: next, startMs: elapsed(), durationMs: 0, completed: false });
      if (timeout) arm(timeout, kind);
    };
    const uploadFinished = () => {
      if (ready && uploaded && !done && stage === 'upload') enter('headers', options.timeouts.headersMs);
    };
    const connected = () => { if (done) return; ready = true; enter('upload'); uploadFinished(); };
    const abort = () => finish('cancelled', 'Measurement cancelled');
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    totalTimer = setTimeout(() => finish('timeout', 'Total deadline exceeded', 'total'), options.timeouts.totalMs);
    const hostname = target.hostname.replace(/^\[|\]$/g, '');
    const origin = route === 'origin' ? options.originIp : undefined;
    if (route === 'origin' && !origin) { finish('error', 'Origin IP is required'); return; }
    const address = origin ?? hostname;
    enter(isIP(address) ? 'tcp' : 'dns', isIP(address) ? options.timeouts.connectMs : options.timeouts.dnsMs);
    try {
      // Connecting to the literal origin bypasses DNS while retaining URL Host and TLS SNI.
      const config: https.RequestOptions = {
        hostname: address, port: origin ? options.originPort ?? target.port : target.port,
        path: target.path, method: options.method, agent: false,
        headers: { ...options.headers, host: new URL(target.url).host, 'x-diagnostic-request-id': sample.requestId, connection: 'close', ...(options.body ? { 'content-length': Buffer.byteLength(options.body) } : {}) },
        servername: isIP(hostname) ? '' : hostname, rejectUnauthorized: true, maxHeaderSize: 16384,
        // Verify the original URL identity even when the TCP endpoint is an origin IP.
        ...(target.protocol === 'https:' ? { checkServerIdentity: (_host: string, cert: import('node:tls').PeerCertificate) => checkServerIdentity(hostname, cert) } : {})
      };
      req = (target.protocol === 'https:' ? https : http).request(config);
      req.on('socket', socket => {
        socket.on('lookup', error => { if (!error && !done && stage === 'dns') enter('tcp', options.timeouts.connectMs); });
        socket.on('connect', () => {
          if (done) return;
          sample.remoteAddress = socket.remoteAddress;
          if (target.protocol === 'https:') enter('tls', options.timeouts.tlsMs); else connected();
        });
        if (socket instanceof TLSSocket) socket.on('secureConnect', () => {
          if (done) return;
          sample.tls = { protocol: socket.getProtocol(), cipher: socket.getCipher().name, authorized: socket.authorized };
          connected();
        });
      });
      req.on('finish', () => { uploaded = true; uploadFinished(); });
      req.on('error', error => finish('error', `Request failed (${(error as NodeJS.ErrnoException).code ?? 'transport error'})`));
      req.on('upgrade', (_response, socket) => { socket.destroy(); finish('error', 'Protocol upgrade is unsupported'); });
      req.on('response', incoming => {
        res = incoming;
        if (done) { incoming.destroy(); return; }
        sample.statusCode = incoming.statusCode;
        sample.headersMs = elapsed();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (responseWhitelist.has(name) && value !== undefined) sample.responseHeaders[name] = (Array.isArray(value) ? value.join(', ') : value).slice(0, 2048);
        }
        enter('body', options.timeouts.bodyIdleMs, 'body-idle');
        incoming.on('data', (chunk: Buffer) => {
          if (done) return;
          sample.bytes += chunk.length;
          if (sample.bytes > options.maxBytes) finish('limit', 'Response byte limit exceeded');
          else arm(options.timeouts.bodyIdleMs, 'body-idle');
        });
        incoming.on('aborted', () => finish('error', 'Response ended before the complete body arrived'));
        incoming.on('error', () => finish('error', 'Response stream failed'));
        incoming.on('end', () => incoming.complete ? finish('complete') : finish('error', 'Incomplete HTTP response'));
        incoming.on('close', () => { if (!incoming.complete) finish('error', 'Response closed prematurely'); });
      });
      req.on('close', () => { if (!done && !res) finish('error', 'Connection closed before response headers'); });
      req.end(options.body || undefined);
    } catch { finish('error', 'Unable to create the HTTP request'); }
  });
}

export function summarizeHttp(samples: HttpSample[]): HttpStats {
  const times = samples.filter(s => s.outcome === 'complete').map(s => s.totalMs).sort((a, b) => a - b);
  const timeouts = samples.filter(s => s.outcome === 'timeout').length;
  const result: HttpStats = { attempted: samples.length, completed: times.length, timeouts,
    errors: samples.filter(s => s.outcome === 'error' || s.outcome === 'limit').length,
    cancelled: samples.filter(s => s.outcome === 'cancelled').length, timeoutRate: samples.length ? timeouts / samples.length : 0,
    httpErrorResponses: samples.filter(s => s.statusCode !== undefined && s.statusCode >= 400).length,
    timeoutResponses: samples.filter(s => s.statusCode === 408 || s.statusCode === 504).length };
  if (times.length) {
    const percentile = (p: number) => times[Math.ceil(p * times.length) - 1];
    Object.assign(result, { minMs: times[0], maxMs: times.at(-1), meanMs: times.reduce((a, b) => a + b, 0) / times.length, p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99) });
  }
  return result;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) { resolve(); return; }
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

export async function runHttpDiagnostics(target: NormalizedTarget, options: HttpOptions, signal?: AbortSignal, onProgress?: (sample: HttpSample) => void): Promise<HttpReport> {
  const samples: HttpSample[] = [];
  for (let index = 1; index <= options.samples && !signal?.aborted; index++) {
    for (const route of (options.originIp ? ['public', 'origin'] : ['public']) as ('public' | 'origin')[]) {
      if (signal?.aborted) break;
      const sample = await measureHttp(target, options, route, index, signal);
      samples.push(sample); onProgress?.(sample);
    }
    if (index < options.samples && !signal?.aborted) await delay(options.intervalMs, signal);
  }
  return { url: target.url, method: options.method, requestedSamples: options.samples, samples,
    publicStats: summarizeHttp(samples.filter(s => s.route === 'public')),
    ...(options.originIp ? { originStats: summarizeHttp(samples.filter(s => s.route === 'origin')) } : {}),
    warnings: [
      ...(signal?.aborted ? ['Đã hủy phép đo. Báo cáo chỉ chứa các request đã bắt đầu; các lần đo còn lại chưa được chạy.'] : []),
      'Mốc headers là lúc nhận và phân tích xong header phản hồi, không phải thời điểm nhận byte đầu chính xác.',
      'Phân vị chỉ tính request hoàn tất, theo nearest rank; số mẫu nhỏ chưa đại diện cho hệ thống.',
      'Request public và origin chạy tuần tự và độc lập; chênh lệch của chúng không phải thời gian xử lý của WAF.',
      'Không tự theo redirect. Đếm byte phản hồi trước giải nén. Báo cáo không lưu thông tin xác thực và body request.'
    ] };
}
