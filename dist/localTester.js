"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runLocalTests = runLocalTests;
const dns = __importStar(require("node:dns/promises"));
const net = __importStar(require("node:net"));
const tls = __importStar(require("node:tls"));
const http = __importStar(require("node:http"));
const https = __importStar(require("node:https"));
const node_child_process_1 = require("node:child_process");
const node_perf_hooks_1 = require("node:perf_hooks");
const utils_1 = require("./utils");
function withTimeout(promise, timeoutMs, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs} ms`)), timeoutMs);
        promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });
}
async function resolveDns(hostname, timeoutMs) {
    const started = node_perf_hooks_1.performance.now();
    try {
        const [a4, a6] = await Promise.allSettled([
            withTimeout(dns.resolve4(hostname), timeoutMs, 'DNS A'),
            withTimeout(dns.resolve6(hostname), timeoutMs, 'DNS AAAA')
        ]);
        const ipv4 = a4.status === 'fulfilled' ? a4.value : [];
        const ipv6 = a6.status === 'fulfilled' ? a6.value : [];
        if (!ipv4.length && !ipv6.length) {
            const reasons = [a4, a6]
                .filter((r) => r.status === 'rejected')
                .map(r => (0, utils_1.errorMessage)(r.reason));
            return { ok: false, summary: reasons.join(' | ') || 'No A/AAAA records returned', latencyMs: Math.round(node_perf_hooks_1.performance.now() - started) };
        }
        return {
            ok: true,
            summary: [...ipv4, ...ipv6].join(', '),
            latencyMs: Math.round(node_perf_hooks_1.performance.now() - started),
            data: { ipv4, ipv6 }
        };
    }
    catch (error) {
        return { ok: false, summary: (0, utils_1.errorMessage)(error), latencyMs: Math.round(node_perf_hooks_1.performance.now() - started) };
    }
}
function tcpConnect(hostname, port, timeoutMs) {
    return new Promise(resolve => {
        const started = node_perf_hooks_1.performance.now();
        const socket = net.createConnection({ host: hostname, port });
        let done = false;
        const finish = (detail) => {
            if (done)
                return;
            done = true;
            socket.destroy();
            resolve(detail);
        };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => finish({ ok: true, summary: `TCP ${port} connected`, latencyMs: Math.round(node_perf_hooks_1.performance.now() - started), data: { remoteAddress: socket.remoteAddress } }));
        socket.once('timeout', () => finish({ ok: false, summary: `TCP ${port} timeout after ${timeoutMs} ms` }));
        socket.once('error', error => finish({ ok: false, summary: (0, utils_1.errorMessage)(error), latencyMs: Math.round(node_perf_hooks_1.performance.now() - started) }));
    });
}
function tlsHandshake(hostname, port, timeoutMs) {
    return new Promise(resolve => {
        const started = node_perf_hooks_1.performance.now();
        const socket = tls.connect({ host: hostname, port, servername: hostname, rejectUnauthorized: false });
        let done = false;
        const finish = (detail) => {
            if (done)
                return;
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
                latencyMs: Math.round(node_perf_hooks_1.performance.now() - started),
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
        socket.once('error', error => finish({ ok: false, summary: (0, utils_1.errorMessage)(error), latencyMs: Math.round(node_perf_hooks_1.performance.now() - started) }));
    });
}
function httpRequest(target, timeoutMs) {
    return new Promise(resolve => {
        const started = node_perf_hooks_1.performance.now();
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
                latencyMs: Math.round(node_perf_hooks_1.performance.now() - started),
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
        req.once('error', error => resolve({ ok: false, summary: (0, utils_1.errorMessage)(error), latencyMs: Math.round(node_perf_hooks_1.performance.now() - started) }));
        req.end();
    });
}
function runProcess(command, args, timeoutMs) {
    return new Promise(resolve => {
        const started = node_perf_hooks_1.performance.now();
        const child = (0, node_child_process_1.spawn)(command, args, { windowsHide: true, shell: false });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const timer = setTimeout(() => {
            child.kill();
            if (!settled) {
                settled = true;
                resolve({ ok: false, summary: `${command} timeout`, latencyMs: Math.round(node_perf_hooks_1.performance.now() - started), raw: stdout || stderr });
            }
        }, timeoutMs);
        child.stdout.on('data', chunk => { if (stdout.length < 12000)
            stdout += chunk.toString(); });
        child.stderr.on('data', chunk => { if (stderr.length < 4000)
            stderr += chunk.toString(); });
        child.once('error', error => {
            clearTimeout(timer);
            if (!settled) {
                settled = true;
                resolve({ ok: false, summary: (0, utils_1.errorMessage)(error), raw: stderr });
            }
        });
        child.once('close', code => {
            clearTimeout(timer);
            if (settled)
                return;
            settled = true;
            const raw = `${stdout}${stderr ? `\n${stderr}` : ''}`.trim();
            resolve({ ok: code === 0, summary: code === 0 ? `${command} completed` : `${command} exited with code ${code}`, latencyMs: Math.round(node_perf_hooks_1.performance.now() - started), raw });
        });
    });
}
async function ping(hostname) {
    const isWindows = process.platform === 'win32';
    return runProcess('ping', isWindows ? ['-n', '3', '-w', '2000', hostname] : ['-c', '3', '-W', '2', hostname], 10000);
}
async function traceroute(hostname) {
    const isWindows = process.platform === 'win32';
    return runProcess(isWindows ? 'tracert' : 'traceroute', isWindows ? ['-d', '-h', '20', '-w', '1000', hostname] : ['-n', '-m', '20', '-w', '1', hostname], 30000);
}
async function runLocalTests(target, selection, timeoutMs) {
    const result = { source: 'Local machine', sourceType: 'local', diagnosis: [] };
    const tasks = [];
    if (selection.dns)
        tasks.push(resolveDns(target.hostname, timeoutMs).then(v => { result.dns = v; }));
    if (selection.ping)
        tasks.push(ping(target.hostname).then(v => { result.ping = v; }));
    if (selection.http) {
        tasks.push(tcpConnect(target.hostname, target.port, timeoutMs).then(v => { result.tcp = v; }));
        if (target.protocol === 'https:')
            tasks.push(tlsHandshake(target.hostname, target.port, timeoutMs).then(v => { result.tls = v; }));
        tasks.push(httpRequest(target, timeoutMs).then(v => { result.http = v; }));
    }
    if (selection.traceroute)
        tasks.push(traceroute(target.hostname).then(v => { result.traceroute = v; }));
    await Promise.all(tasks);
    return result;
}
//# sourceMappingURL=localTester.js.map