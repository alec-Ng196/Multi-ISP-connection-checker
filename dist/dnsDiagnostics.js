"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateDnsOptions = validateDnsOptions;
exports.runDnsDiagnostics = runDnsDiagnostics;
const promises_1 = require("node:dns/promises");
const node_url_1 = require("node:url");
const node_net_1 = require("node:net");
const node_perf_hooks_1 = require("node:perf_hooks");
const recordTypes = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'CAA', 'SRV'];
function validateDnsOptions(input) {
    if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input)))
        throw new Error('DNS options must be an object.');
    const value = (input ?? {});
    const types = value.types ?? ['A', 'AAAA', 'CNAME'];
    if (!Array.isArray(types) || !types.length || types.length > 9 || types.some(type => !recordTypes.includes(type)))
        throw new Error('Select valid DNS record types (ANY is not supported).');
    const timeoutMs = value.timeoutMs ?? 5000;
    if (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000)
        throw new Error('DNS timeout must be 100–30000 ms.');
    if (value.followCname !== undefined && typeof value.followCname !== 'boolean')
        throw new Error('followCname must be boolean.');
    if (value.resolver !== undefined && typeof value.resolver !== 'string')
        throw new Error('DNS resolver must be an IP address with an optional port.');
    const resolver = value.resolver?.trim() || undefined;
    if (resolver) {
        // Validate ports before calling native c-ares: some Node versions abort
        // rather than throw for port zero. Bare IPv6 addresses are also valid.
        if (!(0, node_net_1.isIP)(resolver)) {
            const parts = resolver.match(/^\[([^\]]+)\]:(\d+)$/) ?? resolver.match(/^([^:]+):(\d+)$/);
            const port = parts ? Number(parts[2]) : NaN;
            if (!parts || !(0, node_net_1.isIP)(parts[1]) || !Number.isInteger(port) || port < 1 || port > 65535)
                throw new Error('DNS resolver must be an IP address with an optional port from 1 to 65535.');
        }
        // setServers also validates Node's IPv4:port / [IPv6]:port syntax.
        const probe = new promises_1.Resolver();
        try {
            probe.setServers([resolver]);
        }
        catch {
            throw new Error('DNS resolver must be an IP address with an optional valid port.');
        }
        finally {
            probe.cancel();
        }
    }
    return { types: [...new Set(types)], resolver, timeoutMs, followCname: value.followCname ?? true };
}
function normalizeName(input) {
    if (typeof input !== 'string' || !input.trim() || input.length > 2048)
        throw new Error('Enter a DNS hostname.');
    let name = input.trim();
    if (/^https?:\/\//i.test(name)) {
        const url = new URL(name);
        if (url.username || url.password)
            throw new Error('DNS target must not contain credentials.');
        name = url.hostname;
    }
    if (/[\s/\\:@?#%\[\]]/.test(name))
        throw new Error('Enter a valid DNS hostname.');
    name = (0, node_url_1.domainToASCII)(name.replace(/\.$/, '')).toLowerCase();
    if (!name || name.length > 253 || (0, node_net_1.isIP)(name) || name.split('.').some(label => !/^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/i.test(label)))
        throw new Error('Enter a valid DNS hostname (service names may contain underscores).');
    return name;
}
async function recordsFor(resolver, name, type) {
    const record = (value, details) => ({ name, type, value, ...(details ? { details } : {}) });
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
async function runDnsDiagnostics(hostname, input, signal) {
    const name = normalizeName(hostname);
    const options = validateDnsOptions(input);
    const initial = new promises_1.Resolver();
    if (options.resolver)
        initial.setServers([options.resolver]);
    const servers = initial.getServers();
    initial.cancel();
    const report = { hostname: name, resolvers: servers, queries: [], cnameChain: [], warnings: [] };
    const cached = new Map();
    const query = (host, type) => {
        const key = `${host}:${type}`;
        const existing = cached.get(key);
        if (existing)
            return existing;
        const result = { name: host, type, status: 'cancelled', durationMs: 0, records: [] };
        report.queries.push(result);
        const work = new Promise(resolve => {
            const started = node_perf_hooks_1.performance.now();
            if (signal?.aborted) {
                result.error = 'DNS query cancelled.';
                resolve(result);
                return;
            }
            const resolver = new promises_1.Resolver({ timeout: options.timeoutMs, tries: 1 });
            resolver.setServers(servers);
            let done = false;
            let timer;
            const finish = (status, records = [], error) => {
                if (done)
                    return;
                done = true;
                if (timer)
                    clearTimeout(timer);
                signal?.removeEventListener('abort', abort);
                Object.assign(result, { status, records, durationMs: Math.round((node_perf_hooks_1.performance.now() - started) * 100) / 100 });
                if (error)
                    result.error = error;
                resolver.cancel();
                resolve(result);
            };
            const abort = () => finish('cancelled', [], 'DNS query cancelled.');
            signal?.addEventListener('abort', abort, { once: true });
            timer = setTimeout(() => finish('timeout', [], `DNS query exceeded ${options.timeoutMs} ms.`), options.timeoutMs);
            recordsFor(resolver, host, type).then(records => finish(records.length ? 'ok' : 'no-data', records), error => {
                const code = error.code;
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
            if (alias.status !== 'ok')
                break;
            if (alias.records.length > 1)
                report.warnings.push(`Multiple CNAME targets returned for ${current}; following the first.`);
            let next;
            try {
                next = normalizeName(alias.records[0].value);
            }
            catch {
                report.warnings.push(`Invalid CNAME target returned for ${current}.`);
                break;
            }
            report.cnameChain.push(next);
            if (visited.has(next)) {
                report.warnings.push(`CNAME cycle detected at ${next}.`);
                break;
            }
            visited.add(next);
            current = next;
            if (depth === 7)
                report.warnings.push('CNAME chain stopped after 8 aliases; the terminal target may not have been reached.');
        }
        if (current !== name && !signal?.aborted)
            await Promise.all([query(current, 'A'), query(current, 'AAAA')]);
    }
    return report;
}
//# sourceMappingURL=dnsDiagnostics.js.map