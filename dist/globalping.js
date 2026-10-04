"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GlobalpingClient = void 0;
const utils_1 = require("./utils");
const API = 'https://api.globalping.io/v1';
const DEFAULT_REQUEST_TIMEOUT_MS = 12000;
const DEFAULT_MEASUREMENT_TIMEOUT_MS = 45000;
const DEFAULT_POLL_INTERVAL_MS = 550;
class GlobalpingClient {
    options;
    constructor(options) {
        this.options = options;
    }
    headers() {
        const h = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'Multi-ISP-Domain-Checker/0.1'
        };
        if (this.options.token)
            h.Authorization = `Bearer ${this.options.token}`;
        return h;
    }
    async request(url, init = {}, timeoutMs = this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
        try {
            const response = await fetch(url, { ...init, signal: controller.signal });
            const bodyText = await response.text();
            let body = {};
            try {
                body = bodyText ? JSON.parse(bodyText) : {};
            }
            catch {
                body = { message: bodyText };
            }
            return { response, body, bodyText };
        }
        catch (error) {
            if (controller.signal.aborted)
                throw new Error(`Globalping request timed out after ${timeoutMs} ms.`);
            throw new Error(`Globalping request failed: ${(0, utils_1.errorMessage)(error)}`);
        }
        finally {
            clearTimeout(timer);
        }
    }
    apiError(response, body, bodyText) {
        const message = body?.error?.message || body?.message || bodyText || response.statusText;
        if (response.status !== 429)
            return `Globalping ${response.status}: ${message}`;
        const remaining = response.headers.get('x-ratelimit-remaining') || response.headers.get('x-credits-remaining');
        const reset = response.headers.get('x-ratelimit-reset');
        const limits = [remaining != null ? `remaining: ${remaining}` : '', reset ? `reset: ${reset}s` : ''].filter(Boolean).join(', ');
        return `Globalping 429: ${message}${limits ? ` (${limits})` : ''}`;
    }
    async create(type, target, network, dnsRecordType = 'A', pingProtocol = 'ICMP', reuseMeasurementId) {
        const payload = {
            target: target.hostname,
            type,
            inProgressUpdates: false,
            locations: reuseMeasurementId || [{ magic: `${this.options.country}+${network}`, limit: 1 }]
        };
        if (type === 'ping')
            payload.measurementOptions = {
                packets: 3,
                protocol: pingProtocol,
                ...(pingProtocol === 'TCP' ? { port: target.port } : {}),
                ipVersion: 4
            };
        if (type === 'dns')
            payload.measurementOptions = { query: { type: dnsRecordType }, protocol: 'UDP', ipVersion: 4 };
        if (type === 'traceroute')
            payload.measurementOptions = { protocol: 'ICMP', ipVersion: 4 };
        if (type === 'http') {
            const url = new URL(target.url);
            const request = { method: 'GET', path: url.pathname || '/' };
            if (url.search)
                request.query = url.search.slice(1);
            payload.measurementOptions = {
                protocol: target.protocol === 'https:' ? 'HTTPS' : 'HTTP',
                port: target.port,
                request
            };
        }
        const { response, body, bodyText } = await this.request(`${API}/measurements`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(payload)
        });
        if (!response.ok)
            throw new Error(this.apiError(response, body, bodyText));
        if (!body.id)
            throw new Error('Globalping response did not include a measurement id.');
        return { id: String(body.id), probesCount: Number(body.probesCount ?? 0) };
    }
    async get(id, timeoutMs) {
        const { response, body, bodyText } = await this.request(`${API}/measurements/${encodeURIComponent(id)}`, { headers: this.headers() }, timeoutMs);
        if (!response.ok)
            throw new Error(this.apiError(response, body, bodyText));
        return body;
    }
    async waitForResult(id) {
        const timeoutMs = this.options.measurementTimeoutMs ?? DEFAULT_MEASUREMENT_TIMEOUT_MS;
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const remaining = deadline - Date.now();
            const measurement = await this.get(id, Math.min(this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, remaining));
            if (measurement.status !== 'in-progress')
                return measurement;
            await (0, utils_1.sleep)(Math.min(this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
        }
        throw new Error(`Globalping measurement timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    normalize(type, measurement) {
        const first = measurement?.results?.[0];
        if (!first) {
            return { detail: { ok: false, summary: `No probe result (${measurement?.status || 'unknown status'})`, raw: (0, utils_1.compactRaw)(JSON.stringify(measurement, null, 2)) } };
        }
        const r = first.result || {};
        let ok = r.status === 'finished' || (!r.status && measurement.status === 'finished');
        let summary = r.status || measurement.status || 'finished';
        let latencyMs;
        const data = {
            resolvedAddress: r.resolvedAddress,
            resolvedHostname: r.resolvedHostname,
            failureSource: r.failureSource
        };
        if (type === 'dns') {
            const answers = Array.isArray(r.answers) ? r.answers : [];
            const values = answers.map((a) => a?.value).filter(Boolean);
            ok = ok && Number(r.statusCode ?? 0) === 0;
            summary = `${r.statusCodeName || r.statusCode || r.status || 'DNS'}${values.length ? `: ${values.join(', ')}` : ': no records'}`;
            latencyMs = typeof r.timings?.total === 'number' ? r.timings.total : undefined;
            Object.assign(data, { resolver: r.resolver, statusCode: r.statusCode, statusCodeName: r.statusCodeName, answers });
        }
        else if (type === 'ping') {
            const stats = r.stats || {};
            ok = ok && Number(stats.loss ?? 100) < 100;
            summary = stats.avg != null ? `avg ${stats.avg} ms, loss ${stats.loss ?? '?'}%` : (r.status || 'Ping finished');
            latencyMs = typeof stats.avg === 'number' ? stats.avg : undefined;
            Object.assign(data, { stats });
        }
        else if (type === 'http') {
            const statusCode = Number(r.statusCode || 0);
            summary = statusCode ? `HTTP ${statusCode}` : (r.status || 'HTTP test finished');
            latencyMs = typeof r.timings?.total === 'number' ? r.timings.total : undefined;
            Object.assign(data, { statusCode, headers: r.headers, timings: r.timings, tls: r.tls });
        }
        else if (type === 'traceroute') {
            const hops = Array.isArray(r.hops) ? r.hops : [];
            summary = ok ? `${hops.length} hop${hops.length === 1 ? '' : 's'}` : (r.status || 'Traceroute failed');
            Object.assign(data, { hops });
        }
        return {
            probe: first.probe,
            detail: {
                ok,
                summary,
                latencyMs,
                raw: (0, utils_1.compactRaw)(r.rawOutput),
                data
            }
        };
    }
    mergeDns(a, aaaa) {
        const aAnswers = a.data?.answers ?? [];
        const aaaaAnswers = aaaa.data?.answers ?? [];
        const ipv4 = aAnswers.filter(v => v?.type === 'A').map(v => String(v?.value ?? '')).filter(Boolean);
        const ipv6 = aaaaAnswers.filter(v => v?.type === 'AAAA').map(v => String(v?.value ?? '')).filter(Boolean);
        const raw = [a.raw ? `--- A ---\n${a.raw}` : '', aaaa.raw ? `--- AAAA ---\n${aaaa.raw}` : ''].filter(Boolean).join('\n\n');
        return {
            ok: a.ok && aaaa.ok,
            summary: `A: ${ipv4.join(', ') || (a.ok ? 'no records' : a.summary)}; AAAA: ${ipv6.join(', ') || (aaaa.ok ? 'no records' : aaaa.summary)}`,
            latencyMs: Math.max(a.latencyMs ?? 0, aaaa.latencyMs ?? 0) || undefined,
            raw: (0, utils_1.compactRaw)(raw),
            data: { ipv4, ipv6, answers: [...aAnswers, ...aaaaAnswers], a: a.data, aaaa: aaaa.data }
        };
    }
    addHttpLayers(result, target) {
        const http = result.http;
        if (!http?.ok)
            return;
        const timings = http.data?.timings;
        if (!result.tcp && typeof timings?.tcp === 'number') {
            result.tcp = { ok: true, summary: `TCP ${target.port} connected`, latencyMs: timings.tcp, data: { resolvedAddress: http.data?.resolvedAddress } };
        }
        const certificate = http.data?.tls;
        if (target.protocol === 'https:' && certificate) {
            result.tls = {
                ok: true,
                summary: `${certificate.protocol || 'TLS'}; certificate ${certificate.authorized ? 'valid' : 'not trusted/invalid'}`,
                latencyMs: typeof timings?.tls === 'number' ? timings.tls : undefined,
                data: {
                    authorized: certificate.authorized,
                    authorizationError: certificate.error ?? null,
                    protocol: certificate.protocol,
                    cipher: certificate.cipherName,
                    subject: certificate.subject?.CN,
                    subjectAltNames: certificate.subject?.alt,
                    issuer: certificate.issuer?.CN,
                    validFrom: certificate.createdAt,
                    validTo: certificate.expiresAt,
                    fingerprint256: certificate.fingerprint256
                }
            };
        }
    }
    async runSingle(type, target, network, dnsRecordType = 'A', pingProtocol = 'ICMP', reuseMeasurementId) {
        let measurementId;
        try {
            const created = await this.create(type, target, network, dnsRecordType, pingProtocol, reuseMeasurementId);
            if (created.probesCount < 1)
                throw new Error(`No matching online probe for ${this.options.country}+${network}.`);
            measurementId = created.id;
            const measurement = await this.waitForResult(created.id);
            return { ...this.normalize(type, measurement), measurementId };
        }
        catch (error) {
            return { detail: { ok: false, summary: (0, utils_1.errorMessage)(error) }, measurementId };
        }
    }
    async runNetwork(target, network, selection) {
        const result = {
            source: network,
            sourceType: 'remote',
            network,
            location: `${this.options.country}+${network}`,
            diagnosis: []
        };
        const specs = [];
        if (selection.dns)
            specs.push({ key: 'dnsA', type: 'dns', dnsRecordType: 'A' }, { key: 'dnsAAAA', type: 'dns', dnsRecordType: 'AAAA' });
        if (selection.ping)
            specs.push({ key: 'ping', type: 'ping' });
        if (selection.http)
            specs.push({ key: 'tcp', type: 'ping', pingProtocol: 'TCP' }, { key: 'http', type: 'http' });
        if (selection.traceroute)
            specs.push({ key: 'traceroute', type: 'traceroute' });
        if (!specs.length)
            return result;
        const seedSpec = specs[0];
        const seed = await this.runSingle(seedSpec.type, target, network, seedSpec.dnsRecordType, seedSpec.pingProtocol);
        const runs = new Map([[seedSpec.key, seed]]);
        if (seed.measurementId) {
            const remaining = await Promise.all(specs.slice(1).map(async (spec) => ({
                spec,
                run: await this.runSingle(spec.type, target, network, spec.dnsRecordType, spec.pingProtocol, seed.measurementId)
            })));
            for (const item of remaining)
                runs.set(item.spec.key, item.run);
        }
        else {
            for (const spec of specs.slice(1))
                runs.set(spec.key, { detail: { ...seed.detail } });
        }
        if (selection.dns)
            result.dns = this.mergeDns(runs.get('dnsA').detail, runs.get('dnsAAAA').detail);
        if (selection.ping)
            result.ping = runs.get('ping').detail;
        if (selection.http) {
            const tcp = runs.get('tcp').detail;
            result.tcp = { ...tcp, summary: `TCP ${target.port} ${tcp.ok ? 'connected' : 'failed'}: ${tcp.summary}` };
            result.http = runs.get('http').detail;
        }
        if (selection.traceroute)
            result.traceroute = runs.get('traceroute').detail;
        for (const run of runs.values()) {
            if (!run.probe)
                continue;
            result.network = run.probe.network || result.network;
            result.asn = run.probe.asn || result.asn;
            const parts = [run.probe.city, run.probe.country].filter(Boolean);
            if (parts.length)
                result.location = parts.join(', ');
            break;
        }
        this.addHttpLayers(result, target);
        return result;
    }
}
exports.GlobalpingClient = GlobalpingClient;
//# sourceMappingURL=globalping.js.map