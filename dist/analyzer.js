"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.diagnose = diagnose;
exports.compare = compare;
exports.finalize = finalize;
function httpStatus(result) {
    const value = result.http?.data?.statusCode ?? result.http?.data?.status;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}
function dnsAddresses(result) {
    const data = result.dns?.data;
    if (!data)
        return [];
    const fromLocal = [...(data.ipv4 ?? []), ...(data.ipv6 ?? [])];
    if (fromLocal.length)
        return fromLocal;
    const answers = data.answers ?? [];
    return answers.map(v => String(v?.value ?? '')).filter(Boolean);
}
function diagnose(result) {
    const notes = [];
    if (result.dns && !result.dns.ok) {
        notes.push('DNS failed: investigate resolver, authoritative DNS, DNSSEC or ISP-specific resolution.');
        return notes;
    }
    if (result.tcp && !result.tcp.ok) {
        notes.push('DNS may be working, but TCP connection failed: investigate route, ACL/firewall, service listening state or path filtering.');
    }
    if (result.tls && !result.tls.ok) {
        notes.push('TCP/TLS path problem: check SNI, certificate chain, TLS policy and middleboxes.');
    }
    else if (result.tls?.data?.authorized === false) {
        notes.push(`TLS handshake completed but certificate validation failed (${String(result.tls.data.authorizationError || 'unknown reason')}).`);
    }
    const status = httpStatus(result);
    if (status) {
        if (status >= 200 && status < 300)
            notes.push('HTTP service is reachable and returned a success response.');
        else if (status >= 300 && status < 400)
            notes.push('HTTP service is reachable and returned a redirect; compare Location headers between networks.');
        else if (status === 401 || status === 403)
            notes.push('HTTP path is reachable but access is denied; check WAF/L7 ACL/bot policy/Geo-IP/IP reputation/authentication.');
        else if (status === 404)
            notes.push('HTTP path is reachable; requested path/virtual host was not found.');
        else if (status === 408 || status === 504)
            notes.push('Timeout response observed; investigate upstream latency/path and proxy timeout settings.');
        else if (status === 429)
            notes.push('HTTP path is reachable but rate limiting is active.');
        else if (status >= 500)
            notes.push('HTTP path is reachable but server/proxy/upstream returned a 5xx response.');
        else if (status >= 400)
            notes.push(`HTTP path is reachable but returned client/error status ${status}.`);
    }
    else if (result.http && !result.http.ok) {
        notes.push('HTTP test failed before a usable response was received; compare DNS, TCP/TLS and traceroute.');
    }
    if (result.ping && !result.ping.ok && result.http?.ok) {
        notes.push('Ping failed while HTTP works; ICMP may simply be filtered, so do not treat this alone as an outage.');
    }
    if (!notes.length)
        notes.push('No obvious fault detected from the selected tests.');
    return notes;
}
function compare(results) {
    const notes = [];
    const dnsSets = results
        .filter(r => r.dns?.ok)
        .map(r => ({ source: r.source, ips: dnsAddresses(r).sort() }))
        .filter(v => v.ips.length);
    if (dnsSets.length >= 2) {
        const canonical = JSON.stringify(dnsSets[0].ips);
        const differs = dnsSets.some(v => JSON.stringify(v.ips) !== canonical);
        if (differs)
            notes.push(`DNS answers differ by source: ${dnsSets.map(v => `${v.source}=[${v.ips.join(', ')}]`).join(' | ')}`);
    }
    const reachable = results.filter(r => r.http?.ok).map(r => r.source);
    const failed = results.filter(r => r.http && !r.http.ok).map(r => r.source);
    if (reachable.length && failed.length) {
        notes.push(`HTTP differs by source: reachable from ${reachable.join(', ')}; failed from ${failed.join(', ')}.`);
    }
    const statusPairs = results
        .map(r => ({ source: r.source, status: httpStatus(r) }))
        .filter((v) => v.status !== undefined);
    if (new Set(statusPairs.map(v => v.status)).size > 1) {
        notes.push(`HTTP status differs: ${statusPairs.map(v => `${v.source}=${v.status}`).join(', ')}.`);
    }
    if (!notes.length)
        notes.push('No cross-network difference detected in the selected checks.');
    return notes;
}
function finalize(response) {
    for (const result of response.results)
        result.diagnosis = diagnose(result);
    response.comparison = compare(response.results);
    return response;
}
//# sourceMappingURL=analyzer.js.map