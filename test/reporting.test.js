const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeReport, redactUrl } = require('../dist/reports');
const { parseWafLogs, correlateWafLogs } = require('../dist/wafLogs');

test('report sanitization strips URL secrets and credential headers without changing input', () => {
  const source = { target: { url: 'https://user:password@example.test/path?token=secret&token=another#private', path: '/path?token=secret' }, headers: { Authorization: 'Bearer private', cookie: 'session=private' }, raw: 'URL https://example.test/?token=secret\nSet-Cookie: private\nAuthorization: private' };
  const safe = sanitizeReport(source);
  assert.equal(safe.headers.Authorization, '[redacted]');
  assert.equal(safe.headers.cookie, '[redacted]');
  assert.equal(safe.target.path, '/path?[redacted]');
  assert.doesNotMatch(JSON.stringify(safe), /secret|password|another|private/);
  assert.match(source.target.url, /secret/);
  assert.equal(new URL(redactUrl(source.target.url)).searchParams.get('token'), '[redacted]');
});

test('report sanitization redacts bare-domain input accepted by the connectivity UI', () => {
  const safe = sanitizeReport({ target: { input: 'example.test/path?token=secret#private' } });
  assert.doesNotMatch(JSON.stringify(safe), /secret|private/);
});

test('report sanitization redacts relative and absolute Location query values and fragments', () => {
  for (const location of ['/login?token=secret#private', 'login?token=secret#private', '//example.test/login?token=secret#private', 'https://example.test/login?token=secret#private']) {
    const safe = sanitizeReport({ responseHeaders: { location } });
    assert.doesNotMatch(JSON.stringify(safe), /secret|private/);
    assert.match(safe.responseHeaders.location, /token=/);
  }
});

test('WAF logs accept JSON objects/arrays and JSONL with explicit millisecond fields', () => {
  const row = { requestId: ' req-1 ', requestTimeMs: 101.5, upstreamConnectMs: 0, upstreamHeaderMs: 80, upstreamResponseMs: 100, status: 504, upstreamStatus: 200, authorization: 'discard this', raw: 'discard this too' };
  for (const input of [JSON.stringify(row), JSON.stringify([row]), `${JSON.stringify(row)}\n${JSON.stringify({ requestId: 'req-2', status: 200 })}`]) {
    const parsed = parseWafLogs(input);
    assert.equal(parsed[0].requestId, 'req-1');
    assert.equal(parsed[0].requestTimeMs, 101.5);
    assert.equal(parsed[0].upstreamConnectMs, 0);
    assert.equal(parsed[0].authorization, undefined);
    assert.equal(parsed[0].raw, undefined);
  }
});

test('WAF log parser rejects invalid records, units and bounded input violations', () => {
  const invalid = ['', '[]', 'null', '42', '{}', 'bad json', '{"requestId":"x","status":99}', '{"requestId":"x","status":600}', '{"requestId":"x","requestTimeMs":"1"}', '{"requestId":"x","requestTimeMs":-1}', '{"requestId":"x","requestTimeMs":1e999}', '{"requestId":"x","request_time":1}', JSON.stringify({ requestId: 'x\n', status: 200 }), JSON.stringify(Array.from({ length: 10001 }, () => ({ requestId: 'x', status: 200 }))), ' '.repeat(2 * 1024 * 1024 + 1)];
  for (const input of invalid) assert.throws(() => parseWafLogs(input));
});

test('WAF correlation matches unique client/response IDs and preserves multiple log entries', () => {
  const samples = [
    { index: 1, route: 'public', requestId: 'client-1', responseHeaders: { 'x-request-id': 'edge-1' } },
    { index: 1, route: 'origin', requestId: 'client-2', responseHeaders: { 'x-correlation-id': 'origin-2' } }
  ];
  const logs = [{ requestId: 'client-1', status: 200 }, { requestId: 'edge-1', upstreamConnectMs: 7 }, { requestId: 'origin-2', status: 200 }, { requestId: 'missing', status: 500 }];
  const result = correlateWafLogs(samples, logs);
  assert.equal(result.matchedRecords, 3);
  assert.equal(result.unmatchedRecords, 1);
  assert.equal(result.matches[0].records.length, 2);
  assert.equal(result.matches[0].route, 'public');
  assert.equal(result.matches[1].route, 'origin');
});

test('WAF correlation does not attribute IDs reused across samples', () => {
  const samples = [
    { index: 1, route: 'public', requestId: 'client-1', responseHeaders: { 'x-request-id': 'shared', 'x-correlation-id': 'client-1' } },
    { index: 2, route: 'public', requestId: 'client-2', responseHeaders: { 'x-request-id': 'shared' } }
  ];
  const result = correlateWafLogs(samples, [{ requestId: 'shared', status: 200 }, { requestId: 'client-1', status: 200 }]);
  assert.equal(result.matchedRecords, 1);
  assert.equal(result.unmatchedRecords, 1);
  assert.equal(result.matches[0].sampleIndex, 1);
});
