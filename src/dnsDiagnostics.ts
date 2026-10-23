import { Resolver } from 'node:dns/promises';
import { domainToASCII } from 'node:url';
import { isIP } from 'node:net';
import { performance } from 'node:perf_hooks';
import { DnsOptions, DnsQueryResult, DnsRecord, DnsRecordType, DnsReport } from './diagnosticsTypes';

const recordTypes: DnsRecordType[] = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'CAA', 'SRV'];

export function validateDnsOptions(input: unknown): DnsOptions {
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) throw new Error('DNS options must be an object.');
  const value = (input ?? {}) as Record<string, unknown>;
  const types = value.types ?? ['A', 'AAAA', 'CNAME'];
  if (!Array.isArray(types) || !types.length || types.length > 9 || types.some(type => !recordTypes.includes(type))) throw new Error('Select valid DNS record types (ANY is not supported).');
  const timeoutMs = value.timeoutMs ?? 5000;
  if (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new Error('DNS timeout must be 100–30000 ms.');
  if (value.followCname !== undefined && typeof value.followCname !== 'boolean') throw new Error('followCname must be boolean.');
  if (value.resolver !== undefined && typeof value.resolver !== 'string') throw new Error('DNS resolver must be an IP address with an optional port.');
  const resolver = (value.resolver as string | undefined)?.trim() || undefined;
  if (resolver) {
    // Validate ports before calling native c-ares: some Node versions abort
    // rather than throw for port zero. Bare IPv6 addresses are also valid.
    if (!isIP(resolver)) {
      const parts = resolver.match(/^\[([^\]]+)\]:(\d+)$/) ?? resolver.match(/^([^:]+):(\d+)$/);
      const port = parts ? Number(parts[2]) : NaN;
      if (!parts || !isIP(parts[1]) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DNS resolver must be an IP address with an optional port from 1 to 65535.');
    }
    // setServers also validates Node's IPv4:port / [IPv6]:port syntax.
    const probe = new Resolver();
    try { probe.setServers([resolver]); } catch { throw new Error('DNS resolver must be an IP address with an optional valid port.'); }
    finally { probe.cancel(); }
  }
  return { types: [...new Set(types)] as DnsRecordType[], resolver, timeoutMs, followCname: value.followCname as boolean | undefined ?? true };
}

function normalizeName(input: string): string {
  if (typeof input !== 'string' || !input.trim() || input.length > 2048) throw new Error('Enter a DNS hostname.');
  let name = input.trim();
  if (/^https?:\/\//i.test(name)) {
    const url = new URL(name);
    if (url.username || url.password) throw new Error('DNS target must not contain credentials.');
    name = url.hostname;
  }
  if (/[\s/\\:@?#%\[\]]/.test(name)) throw new Error('Enter a valid DNS hostname.');
  name = domainToASCII(name.replace(/\.$/, '')).toLowerCase();
  if (!name || name.length > 253 || isIP(name) || name.split('.').some(label => !/^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/i.test(label))) throw new Error('Enter a valid DNS hostname (service names may contain underscores).');
  return name;
}

async function recordsFor(resolver: Resolver, name: string, type: DnsRecordType): Promise<DnsRecord[]> {
  const record = (value: string, details?: Record<string, unknown>): DnsRecord => ({ name, type, value, ...(details ? { details } : {}) });
  switch (type) {
    case 'A': return (await resolver.resolve4(name, { ttl: true })).map(r => ({ ...record(r.address), ttl: r.ttl }));
    case 'AAAA': return (await resolver.resolve6(name, { ttl: true })).map(r => ({ ...record(r.address), ttl: r.ttl }));
    case 'CNAME': return (await resolver.resolveCname(name)).map(r => record(r));
    case 'NS': return (await resolver.resolveNs(name)).map(r => record(r));
    case 'TXT': return (await resolver.resolveTxt(name)).map(segments => record(segments.join(''), { segments }));
    case 'MX': return (await resolver.resolveMx(name)).map(r => record(`${r.priority} ${r.exchange}`, { ...r }));
    case 'SRV': return (await resolver.resolveSrv(name)).map(r => record(`${r.priority} ${r.weight} ${r.port} ${r.name}`, { ...r }));
    case 'SOA': {
      const r = await resolver.resolveSoa(name);
      return [record(`${r.nsname} ${r.hostmaster} ${r.serial} ${r.refresh} ${r.retry} ${r.expire} ${r.minttl}`, { ...r })];
    }
    case 'CAA': return (await resolver.resolveCaa(name)).map(r => record(Object.entries(r).map(([k, v]) => `${k}=${v}`).join(' '), { ...r }));
  }
}

export async function runDnsDiagnostics(hostname: string, input: DnsOptions, signal?: AbortSignal): Promise<DnsReport> {
  const name = normalizeName(hostname);
  const options = validateDnsOptions(input);
  const initial = new Resolver();
  if (options.resolver) initial.setServers([options.resolver]);
  const servers = initial.getServers();
  initial.cancel();
  const report: DnsReport = { hostname: name, resolvers: servers, queries: [], cnameChain: [], warnings: [] };
  const cached = new Map<string, Promise<DnsQueryResult>>();
  const query = (host: string, type: DnsRecordType): Promise<DnsQueryResult> => {
    const key = `${host}:${type}`;
    const existing = cached.get(key);
    if (existing) return existing;
    const result: DnsQueryResult = { name: host, type, status: 'cancelled', durationMs: 0, records: [] };
    report.queries.push(result);
    const work = new Promise<DnsQueryResult>(resolve => {
      const started = performance.now();
      if (signal?.aborted) { result.error = 'DNS query cancelled.'; resolve(result); return; }
      const resolver = new Resolver({ timeout: options.timeoutMs, tries: 1 });
      resolver.setServers(servers);
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (status: DnsQueryResult['status'], records: DnsRecord[] = [], error?: string) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        Object.assign(result, { status, records, durationMs: Math.round((performance.now() - started) * 100) / 100 });
        if (error) result.error = error;
        resolver.cancel();
        resolve(result);
      };
      const abort = () => finish('cancelled', [], 'DNS query cancelled.');
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => finish('timeout', [], `DNS query exceeded ${options.timeoutMs} ms.`), options.timeoutMs);
      recordsFor(resolver, host, type).then(records => finish(records.length ? 'ok' : 'no-data', records), error => {
        const code = (error as NodeJS.ErrnoException).code;
        const status = code === 'ENODATA' ? 'no-data' : code === 'ENOTFOUND' ? 'not-found' : code === 'ETIMEOUT' ? 'timeout' : code === 'ECANCELLED' ? 'cancelled' : 'error';
        finish(status, [], `${code ?? 'DNS_ERROR'}: ${error instanceof Error ? error.message : String(error)}`);
      });
    });
    cached.set(key, work);
    return work;
  };
  await Promise.all(options.types.map(type => query(name, type)));
  if (options.followCname && !signal?.aborted) {
    let current = name;
    const visited = new Set([name]);
    for (let depth = 0; depth < 8 && !signal?.aborted; depth++) {
      const alias = await query(current, 'CNAME');
      if (alias.status !== 'ok') break;
      if (alias.records.length > 1) report.warnings.push(`Multiple CNAME targets returned for ${current}; following the first.`);
      let next: string;
      try { next = normalizeName(alias.records[0].value); } catch { report.warnings.push(`Invalid CNAME target returned for ${current}.`); break; }
      report.cnameChain.push(next);
      if (visited.has(next)) { report.warnings.push(`CNAME cycle detected at ${next}.`); break; }
      visited.add(next);
      current = next;
      if (depth === 7) report.warnings.push('CNAME chain stopped after 8 aliases; the terminal target may not have been reached.');
    }
    if (current !== name && !signal?.aborted) await Promise.all([query(current, 'A'), query(current, 'AAAA')]);
  }
  return report;
}
