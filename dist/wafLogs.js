"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseWafLogs = parseWafLogs;
exports.correlateWafLogs = correlateWafLogs;
const timingKeys = ['requestTimeMs', 'upstreamConnectMs', 'upstreamHeaderMs', 'upstreamResponseMs'];
/** Generic normalized log format: milliseconds, never guess vendor-specific units. */
function parseWafLogs(text) {
    if (Buffer.byteLength(text, 'utf8') > 2 * 1024 * 1024)
        throw new Error('Log tối đa 2 MiB.');
    const trimmed = text.trim();
    if (!trimmed)
        throw new Error('File log trống.');
    let values;
    try {
        const parsed = JSON.parse(trimmed);
        values = Array.isArray(parsed) ? parsed : [parsed];
    }
    catch {
        try {
            values = trimmed.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
        }
        catch {
            throw new Error('Log phải là JSON array, một JSON object hoặc JSONL (mỗi dòng một object).');
        }
    }
    if (!values.length || values.length > 10000)
        throw new Error('Log cần từ 1 đến 10.000 bản ghi.');
    return values.map((value, index) => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error(`Log ${index + 1}: cần JSON object.`);
        const input = value;
        if (typeof input.requestId !== 'string' || !input.requestId.trim() || input.requestId.length > 256 || /[\r\n\x00]/.test(input.requestId)) {
            throw new Error(`Log ${index + 1}: requestId phải là chuỗi không rỗng, tối đa 256 ký tự.`);
        }
        const record = { requestId: input.requestId.trim() };
        for (const key of timingKeys) {
            const n = input[key];
            if (n === undefined || n === null)
                continue;
            if (typeof n !== 'number' || !Number.isFinite(n) || n < 0)
                throw new Error(`Log ${index + 1}: ${key} phải là số millisecond không âm.`);
            record[key] = n;
        }
        for (const key of ['status', 'upstreamStatus']) {
            const n = input[key];
            if (n === undefined || n === null)
                continue;
            if (typeof n !== 'number' || !Number.isInteger(n) || n < 100 || n > 599)
                throw new Error(`Log ${index + 1}: ${key} không hợp lệ.`);
            record[key] = n;
        }
        if (Object.keys(record).length === 1)
            throw new Error(`Log ${index + 1}: cần ít nhất một trường timing hoặc status.`);
        return record;
    });
}
function correlateWafLogs(samples, records) {
    const owners = new Map();
    for (const sample of samples) {
        const ids = new Set([sample.requestId, sample.responseHeaders['x-request-id'], sample.responseHeaders['x-correlation-id']].filter(Boolean));
        for (const id of ids)
            owners.set(id, [...(owners.get(id) ?? []), sample]);
    }
    const groups = new Map();
    let matchedRecords = 0;
    for (const record of records) {
        const candidates = owners.get(record.requestId);
        // An ID reused by multiple requests is ambiguous; do not attribute its timing.
        if (candidates?.length !== 1)
            continue;
        const sample = candidates[0];
        groups.set(sample, [...(groups.get(sample) ?? []), record]);
        matchedRecords++;
    }
    return {
        matches: [...groups].map(([sample, logs]) => ({ requestId: sample.requestId, sampleIndex: sample.index, route: sample.route, records: logs })),
        matchedRecords, unmatchedRecords: records.length - matchedRecords
    };
}
//# sourceMappingURL=wafLogs.js.map