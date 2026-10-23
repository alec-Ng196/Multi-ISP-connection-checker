"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeTarget = normalizeTarget;
exports.sleep = sleep;
exports.errorMessage = errorMessage;
exports.compactRaw = compactRaw;
function normalizeTarget(input) {
    const trimmed = input.trim();
    if (!trimmed)
        throw new Error('Domain is required.');
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    let url;
    try {
        url = new URL(withScheme);
    }
    catch {
        throw new Error('Invalid domain or URL. Example: example.com or https://example.com/path');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Only HTTP and HTTPS targets are supported.');
    }
    if (url.username || url.password)
        throw new Error('Không đặt username/password trong URL. Dùng trường HTTP headers của chế độ HTTP / WAF.');
    const hostname = url.hostname;
    if (!hostname || hostname.length > 253 || /[\s/\\]/.test(hostname)) {
        throw new Error('Invalid hostname.');
    }
    const protocol = url.protocol;
    const port = url.port ? Number(url.port) : protocol === 'https:' ? 443 : 80;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('Invalid port.');
    }
    return {
        input: trimmed,
        hostname,
        protocol,
        port,
        path: `${url.pathname || '/'}${url.search || ''}`,
        url: url.toString()
    };
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function compactRaw(value) {
    if (typeof value !== 'string' || !value.trim())
        return undefined;
    return value.length > 12000 ? `${value.slice(0, 12000)}\n…[truncated]` : value;
}
//# sourceMappingURL=utils.js.map