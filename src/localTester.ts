import * as dns from 'node:dns/promises';
import * as net from 'node:net';
import * as tls from 'node:tls';
import * as http from 'node:http';
import * as https from 'node:https';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { CheckDetail, NormalizedTarget, SourceResult, TestSelection } from './types';
import { errorMessage } from './utils';

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs} ms`)), timeoutMs);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

async function resolveDns(hostname: string, timeoutMs: number): Promise<CheckDetail> {
  const started = performance.now();
  try {
    const [a4, a6] = await Promise.allSettled([
      withTimeout(dns.resolve4(hostname), timeoutMs, 'DNS A'),
      withTimeout(dns.resolve6(hostname), timeoutMs, 'DNS AAAA')
    ]);
    const ipv4 = a4.status === 'fulfilled' ? a4.value : [];
    const ipv6 = a6.status === 'fulfilled' ? a6.value : [];
    if (!ipv4.length && !ipv6.length) {
      const reasons = [a4, a6]
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map(r => errorMessage(r.reason));
      return { ok: false, summary: reasons.join(' | ') || 'No A/AAAA records returned', latencyMs: Math.round(performance.now() - started) };
    }
    return {
      ok: true,
      summary: [...ipv4, ...ipv6].join(', '),
      latencyMs: Math.round(performance.now() - started),
      data: { ipv4, ipv6 }
    };
  } catch (error) {
    return { ok: false, summary: errorMessage(error), latencyMs: Math.round(performance.now() - started) };
  }
}

function tcpConnect(hostname: string, port: number, timeoutMs: number): Promise<CheckDetail> {
  return new Promise(resolve => {
    const started = performance.now();
    const socket = net.createConnection({ host: hostname, port });
    let done = false;
    const finish = (detail: CheckDetail) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(detail);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ ok: true, summary: `TCP ${port} connected`, latencyMs: Math.round(performance.now() - started), data: { remoteAddress: socket.remoteAddress } }));
    socket.once('timeout', () => finish({ ok: false, summary: `TCP ${port} timeout after ${timeoutMs} ms` }));
    socket.once('error', error => finish({ ok: false, summary: errorMessage(error), latencyMs: Math.round(performance.now() - started) }));
  });
}

function tlsHandshake(hostname: string, port: number, timeoutMs: number): Promise<CheckDetail> {
  return new Promise(resolve => {
    const started = performance.now();
    const socket = tls.connect({ host: hostname, port, servername: hostname, rejectUnauthorized: false });
    let done = false;
    const finish = (detail: CheckDetail) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(detail);
    };
    socket.setTimeout(timeoutMs);
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      const authorized = socket.authorized;
      const protocol = socket.getProtocol();
      finish({
        ok: true,
        summary: `${protocol ?? 'TLS'}; certificate ${authorized ? 'valid' : 'not trusted/invalid'}`,
        latencyMs: Math.round(performance.now() - started),
        data: {
          authorized,
          authorizationError: socket.authorizationError ?? null,
          protocol,
          cipher: socket.getCipher()?.name,
          subject: cert?.subject?.CN,
          issuer: cert?.issuer?.CN,
          validTo: cert?.valid_to
        }
      });
    });
    socket.once('timeout', () => finish({ ok: false, summary: `TLS timeout after ${timeoutMs} ms` }));
    socket.once('error', error => finish({ ok: false, summary: errorMessage(error), latencyMs: Math.round(performance.now() - started) }));
  });
}

function httpRequest(target: NormalizedTarget, timeoutMs: number): Promise<CheckDetail> {
  return new Promise(resolve => {
    const started = performance.now();
    const client = target.protocol === 'https:' ? https : http;
    const req = client.request({
      hostname: target.hostname,
      port: target.port,
      path: target.path,
      method: 'GET',
      headers: {
        'User-Agent': 'Multi-ISP-Domain-Checker/0.1',
        'Accept': '*/*',
        'Connection': 'close'
      },
      timeout: timeoutMs,
      rejectUnauthorized: true
    }, res => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      res.resume();
      resolve({
        ok: status > 0 && status < 500,
        summary: `HTTP ${status}${location ? ` → ${location}` : ''}`,
        latencyMs: Math.round(performance.now() - started),
        data: {
          status,
          remoteAddress: res.socket.remoteAddress,
          server: res.headers.server,
          location,
          contentType: res.headers['content-type']
        }
      });
    });
    req.once('timeout', () => req.destroy(new Error(`HTTP timeout after ${timeoutMs} ms`)));
    req.once('error', error => resolve({ ok: false, summary: errorMessage(error), latencyMs: Math.round(performance.now() - started) }));
    req.end();
  });
}

function runProcess(command: string, args: string[], timeoutMs: number): Promise<CheckDetail> {
  return new Promise(resolve => {
    const started = performance.now();
    const child = spawn(command, args, { windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      if (!settled) {
        settled = true;
        resolve({ ok: false, summary: `${command} timeout`, latencyMs: Math.round(performance.now() - started), raw: stdout || stderr });
      }
    }, timeoutMs);

    child.stdout.on('data', chunk => { if (stdout.length < 12000) stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { if (stderr.length < 4000) stderr += chunk.toString(); });
    child.once('error', error => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({ ok: false, summary: errorMessage(error), raw: stderr });
      }
    });
    child.once('close', code => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const raw = `${stdout}${stderr ? `\n${stderr}` : ''}`.trim();
      resolve({ ok: code === 0, summary: code === 0 ? `${command} completed` : `${command} exited with code ${code}`, latencyMs: Math.round(performance.now() - started), raw });
    });
  });
}

async function ping(hostname: string): Promise<CheckDetail> {
  const isWindows = process.platform === 'win32';
  return runProcess('ping', isWindows ? ['-n', '3', '-w', '2000', hostname] : ['-c', '3', '-W', '2', hostname], 10000);
}

async function traceroute(hostname: string): Promise<CheckDetail> {
  const isWindows = process.platform === 'win32';
  return runProcess(isWindows ? 'tracert' : 'traceroute', isWindows ? ['-d', '-h', '20', '-w', '1000', hostname] : ['-n', '-m', '20', '-w', '1', hostname], 30000);
}

export async function runLocalTests(target: NormalizedTarget, selection: TestSelection, timeoutMs: number): Promise<SourceResult> {
  const result: SourceResult = { source: 'Local machine', sourceType: 'local', diagnosis: [] };

  const tasks: Promise<void>[] = [];
  if (selection.dns) tasks.push(resolveDns(target.hostname, timeoutMs).then(v => { result.dns = v; }));
  if (selection.ping) tasks.push(ping(target.hostname).then(v => { result.ping = v; }));
  if (selection.http) {
    tasks.push(tcpConnect(target.hostname, target.port, timeoutMs).then(v => { result.tcp = v; }));
    if (target.protocol === 'https:') tasks.push(tlsHandshake(target.hostname, target.port, timeoutMs).then(v => { result.tls = v; }));
    tasks.push(httpRequest(target, timeoutMs).then(v => { result.http = v; }));
  }
  if (selection.traceroute) tasks.push(traceroute(target.hostname).then(v => { result.traceroute = v; }));

  await Promise.all(tasks);
  return result;
}
