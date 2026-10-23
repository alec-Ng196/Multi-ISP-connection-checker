const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { validateHttpOptions, measureHttp, runHttpDiagnostics, summarizeHttp } = require('../dist/httpDiagnostics');
const { normalizeTarget } = require('../dist/utils');

async function serverFixture(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { target: normalizeTarget(`http://127.0.0.1:${server.address().port}/check?q=1`), port: server.address().port };
}
const options = changes => validateHttpOptions({ samples: 1, ...changes });

test('HTTP diagnostics validate bounds, header injection and managed headers', () => {
  for (const input of [{ samples: '3' }, { samples: 0 }, { samples: 51 }, { intervalMs: 99 }, { timeouts: { totalMs: 99 } }, { timeouts: [] }, { headers: { bad: 'x\r\ny' } }, { headers: { Host: 'evil' } }, { headers: { 'x-diagnostic-request-id': 'fake' } }, { headers: { 'Content-Length': '123' } }, { headers: { connection: 'upgrade' } }, { headers: { expect: '100-continue' } }, { headers: { A: 'a', a: 'b' } }, { method: 'CONNECT' }, { method: 'GET', body: 'x' }, { body: 'x'.repeat(65537), method: 'POST' }, { originIp: 'example.com' }, { originPort: 12 }, { maxBytes: Infinity }]) {
    assert.throws(() => validateHttpOptions(input), JSON.stringify(input).slice(0, 150));
  }
  assert.equal(options({}).samples, 1);
  assert.equal(validateHttpOptions({}).samples, 3);
});

test('HTTP complete includes body time, distinct IDs, bounded safe response headers', async t => {
  const f = await serverFixture(t, (_req, res) => {
    res.writeHead(200, { 'x-request-id': 'server-id', 'set-cookie': 'private=x', 'server-timing': 'app;dur=4' });
    res.write('abc'); setTimeout(() => res.end('def'), 60);
  });
  const a = await measureHttp(f.target, options({}), 'public', 1);
  const b = await measureHttp(f.target, options({}), 'public', 2);
  assert.equal(a.outcome, 'complete'); assert.equal(a.bytes, 6);
  assert.ok(a.totalMs > a.headersMs + 35);
  assert.notEqual(a.requestId, b.requestId);
  assert.equal(a.responseHeaders['x-request-id'], 'server-id');
  assert.equal(a.responseHeaders['set-cookie'], undefined);
  assert.deepEqual(a.stages.map(s => s.stage), ['tcp', 'upload', 'headers', 'body']);
  assert.ok(a.stages.every(s => s.completed));
});

test('slow response headers reach headers deadline with partial stage', async t => {
  const f = await serverFixture(t, (_req, _res) => {});
  const sample = await measureHttp(f.target, options({ timeouts: { headersMs: 100, totalMs: 1000 } }), 'public', 1);
  assert.equal(sample.outcome, 'timeout'); assert.equal(sample.failedStage, 'headers');
  assert.equal(sample.timeoutKind, 'headers'); assert.equal(sample.stages.at(-1).completed, false);
  assert.ok(sample.totalMs < 800);
});

test('body idle timeout retains partial bytes and received status', async t => {
  const f = await serverFixture(t, (_req, res) => { res.writeHead(200); res.write('partial'); });
  const sample = await measureHttp(f.target, options({ timeouts: { bodyIdleMs: 100 } }), 'public', 1);
  assert.equal(sample.timeoutKind, 'body-idle'); assert.equal(sample.bytes, 7);
  assert.equal(sample.failedStage, 'body'); assert.equal(sample.statusCode, 200);
});

test('hard total deadline is not reset by continuously arriving bytes', async t => {
  const f = await serverFixture(t, (_req, res) => {
    res.write('start'); const timer = setInterval(() => res.write('x'), 25);
    res.on('close', () => clearInterval(timer));
  });
  const sample = await measureHttp(f.target, options({ timeouts: { bodyIdleMs: 100, totalMs: 180 } }), 'public', 1);
  assert.equal(sample.timeoutKind, 'total'); assert.ok(sample.bytes > 5);
  assert.ok(sample.totalMs < 800);
});

test('truncated response is an error and is excluded from completed statistics', async t => {
  const f = await serverFixture(t, (_req, res) => {
    res.writeHead(200, { 'content-length': 100 }); res.write('short');
    setTimeout(() => res.destroy(), 25);
  });
  const sample = await measureHttp(f.target, options({}), 'public', 1);
  assert.equal(sample.outcome, 'error'); assert.equal(sample.failedStage, 'body');
  assert.equal(sample.bytes, 5); assert.equal(summarizeHttp([sample]).completed, 0);
});

test('byte limit stops body without retaining content', async t => {
  const f = await serverFixture(t, (_req, res) => res.end('x'.repeat(4096)));
  const sample = await measureHttp(f.target, options({ maxBytes: 1024 }), 'public', 1);
  assert.equal(sample.outcome, 'limit'); assert.equal(sample.failedStage, 'body');
  assert.equal(sample.body, undefined);
});

test('cancellation destroys request and cancels subsequent measurements', async t => {
  let calls = 0;
  const f = await serverFixture(t, () => { calls++; });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 70);
  const report = await runHttpDiagnostics(f.target, options({ samples: 3 }), controller.signal);
  assert.equal(calls, 1); assert.equal(report.samples.length, 1);
  assert.equal(report.samples[0].outcome, 'cancelled');
});

test('cancellation during repeat interval stops promptly', async t => {
  const f = await serverFixture(t, (_req, res) => res.end('ok'));
  const controller = new AbortController();
  const start = Date.now();
  const report = await runHttpDiagnostics(f.target, options({ samples: 3, intervalMs: 60000 }), controller.signal, () => setTimeout(() => controller.abort(), 25));
  assert.equal(report.samples.length, 1); assert.ok(Date.now() - start < 1000);
  assert.ok(report.warnings.some(warning => /hủy/.test(warning)));
});

test('pre-cancelled report explicitly explains why no samples ran', async () => {
  const controller = new AbortController(); controller.abort();
  const report = await runHttpDiagnostics(normalizeTarget('https://customer.invalid'), options({}), controller.signal);
  assert.equal(report.samples.length, 0); assert.ok(report.warnings.some(warning => /hủy/.test(warning)));
});

test('dual-stack lookup does not duplicate or restart the TCP stage', async t => {
  const dns = require('node:dns');
  const originalLookup = dns.lookup;
  const f = await serverFixture(t, (_req, res) => res.end('ok'));
  dns.lookup = (hostname, config, callback) => {
    if (hostname !== 'diagnostic.test') return originalLookup(hostname, config, callback);
    if (config.all) setImmediate(callback, null, [{ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 }]);
    else setImmediate(callback, null, '127.0.0.1', 4);
  };
  t.after(() => { dns.lookup = originalLookup; });
  const sample = await measureHttp(normalizeTarget(`http://diagnostic.test:${f.port}/`), options({}), 'public', 1);
  assert.equal(sample.outcome, 'complete');
  assert.equal(sample.stages.filter(stage => stage.stage === 'tcp').length, 1);
  assert.equal(sample.stages.filter(stage => stage.stage === 'dns').length, 1);
});

test('origin override preserves original Host, path, custom method, headers and body', async t => {
  let captured;
  const f = await serverFixture(t, (req, res) => {
    let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => {
      captured = { method: req.method, host: req.headers.host, auth: req.headers.authorization, id: req.headers['x-diagnostic-request-id'], path: req.url, body };
      res.end('ok');
    });
  });
  const target = normalizeTarget('http://customer.invalid:8080/api?q=test');
  const sample = await measureHttp(target, options({ originIp: '127.0.0.1', originPort: f.port, method: 'PATCH', headers: { authorization: 'Bearer secret' }, body: 'private body' }), 'origin', 1);
  assert.equal(sample.outcome, 'complete');
  assert.deepEqual(captured, { method: 'PATCH', host: 'customer.invalid:8080', auth: 'Bearer secret', id: sample.requestId, path: '/api?q=test', body: 'private body' });
  assert.ok(!JSON.stringify(sample).includes('secret')); assert.ok(!JSON.stringify(sample).includes('private body'));
});

test('HTTP error status is complete transport', async t => {
  let hits = 0;
  const f = await serverFixture(t, (_req, res) => { hits++; res.writeHead(504); res.end('gateway timeout'); });
  const sample = await measureHttp(f.target, options({}), 'public', 1);
  assert.equal(sample.outcome, 'complete');
  const stats = summarizeHttp([sample]);
  assert.equal(stats.completed, 1); assert.equal(stats.timeouts, 0); assert.equal(stats.timeoutResponses, 1); assert.equal(stats.httpErrorResponses, 1);
  assert.equal(hits, 1);
});

test('redirect response completes without following its destination', async t => {
  let hits = 0;
  const f = await serverFixture(t, (_req, res) => { hits++; res.writeHead(302, { location: '/another' }); res.end(); });
  const sample = await measureHttp(f.target, options({}), 'public', 1);
  assert.equal(sample.outcome, 'complete'); assert.equal(sample.statusCode, 302); assert.equal(hits, 1);
  assert.equal(sample.responseHeaders.location, '/another');
});

test('HEAD completes without consuming the advertised representation body', async t => {
  const f = await serverFixture(t, (_req, res) => { res.writeHead(200, { 'content-length': 999 }); res.end(); });
  const sample = await measureHttp(f.target, options({ method: 'HEAD' }), 'public', 1);
  assert.equal(sample.outcome, 'complete'); assert.equal(sample.bytes, 0);
});

test('unexpected protocol upgrade closes the upgraded socket', async t => {
  const f = await serverFixture(t, (_req, res) => { res.writeHead(101, { upgrade: 'websocket', connection: 'Upgrade' }); res.end(); });
  const sample = await measureHttp(f.target, options({}), 'public', 1);
  assert.equal(sample.outcome, 'error'); assert.match(sample.error, /upgrade/);
});

test('paired measurements preserve order and separate route statistics', async t => {
  const f = await serverFixture(t, (_req, res) => res.end('ok'));
  const report = await runHttpDiagnostics(f.target, options({ samples: 2, intervalMs: 100, originIp: '127.0.0.1', originPort: f.port }));
  assert.deepEqual(report.samples.map(s => `${s.index}:${s.route}`), ['1:public', '1:origin', '2:public', '2:origin']);
  assert.equal(report.publicStats.completed, 2); assert.equal(report.originStats.completed, 2);
});

test('nearest rank percentiles use only complete samples and rates use attempts', () => {
  const samples = [10, 20, 30, 40].map(totalMs => ({ outcome: 'complete', totalMs, statusCode: 200 }));
  samples.push({ outcome: 'timeout', totalMs: 9999 }, { outcome: 'error', totalMs: 10000 });
  const s = summarizeHttp(samples);
  assert.equal(s.p50Ms, 20); assert.equal(s.p95Ms, 40); assert.equal(s.p99Ms, 40);
  assert.equal(s.meanMs, 25); assert.equal(s.timeoutRate, 1 / 6); assert.equal(s.errors, 1);
  assert.equal(summarizeHttp([]).timeoutRate, 0); assert.equal(summarizeHttp([]).p50Ms, undefined);
});

// Public test-only self-signed fixture; never used for real requests.
const fixtureKey = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg4h/U5zl5TJ7tPwND
6FX/vAm3VPQv7VfKxM6mLLXORVShRANCAAS314qt6r0RDQdBVG3BPqdBcth7Ny/j
omjD7EOePWhf8emfZ98qdDyL2yHsyWZuoAN93u7fP2tjexjikOFy2s2d
-----END PRIVATE KEY-----
`;
const fixtureCert = `-----BEGIN CERTIFICATE-----
MIIBqTCCAU6gAwIBAgIUUSMvjk/CCyZjLZl9aIbNGtRUxiswCgYIKoZIzj0EAwIw
GzEZMBcGA1UEAwwQY3VzdG9tZXIuaW52YWxpZDAeFw0yNjEwMjExNzA2NTZaFw0z
NjEwMTgxNzA2NTZaMBsxGTAXBgNVBAMMEGN1c3RvbWVyLmludmFsaWQwWTATBgcq
hkjOPQIBBggqhkjOPQMBBwNCAAS314qt6r0RDQdBVG3BPqdBcth7Ny/jomjD7EOe
PWhf8emfZ98qdDyL2yHsyWZuoAN93u7fP2tjexjikOFy2s2do3AwbjAdBgNVHQ4E
FgQUUSDy5l9SsO316kF6d177ndau1igwHwYDVR0jBBgwFoAUUSDy5l9SsO316kF6
d177ndau1igwDwYDVR0TAQH/BAUwAwEB/zAbBgNVHREEFDASghBjdXN0b21lci5p
bnZhbGlkMAoGCCqGSM49BAMCA0kAMEYCIQCAtFOpjFo0Uj22UD/ECm1rOFC9fvwx
Y31xnJP34kpcXQIhAKwXNPY243s9oe0XTNAnPs47JTk7gjEjtDTD4YItrEhB
-----END CERTIFICATE-----
`;

test('TLS preserves origin SNI and rejects an untrusted certificate', async t => {
  const tls = require('node:tls');
  let sni;
  const sockets = new Set();
  const server = tls.createServer({ key: fixtureKey, cert: fixtureCert, SNICallback(name, callback) {
    sni = name; callback(null, tls.createSecureContext({ key: fixtureKey, cert: fixtureCert }));
  } });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('tlsClientError', () => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { for (const socket of sockets) socket.destroy(); server.close(resolve); }));
  const target = normalizeTarget('https://customer.invalid/');
  const sample = await measureHttp(target, options({ originIp: '127.0.0.1', originPort: server.address().port }), 'origin', 1);
  assert.equal(sni, 'customer.invalid'); assert.equal(sample.outcome, 'error'); assert.equal(sample.failedStage, 'tls');
  assert.match(sample.error, /CERT|SELF_SIGNED/);
});

test('TLS handshake has its own absolute deadline', async t => {
  const net = require('node:net');
  const sockets = new Set();
  const server = net.createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { for (const socket of sockets) socket.destroy(); server.close(resolve); }));
  const target = normalizeTarget(`https://127.0.0.1:${server.address().port}/`);
  const sample = await measureHttp(target, options({ timeouts: { tlsMs: 100, totalMs: 2000 } }), 'public', 1);
  assert.equal(sample.outcome, 'timeout'); assert.equal(sample.failedStage, 'tls'); assert.equal(sample.timeoutKind, 'tls');
});

test('trusted HTTPS origin keeps original Host/SNI and rejects a different hostname', async t => {
  const https = require('node:https');
  const tls = require('node:tls');
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const { execFile } = require('node:child_process');
  const { promisify } = require('node:util');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'diagnostic-trust-'));
  const certPath = path.join(directory, 'ca.pem');
  fs.writeFileSync(certPath, fixtureCert);
  t.after(() => { fs.unlinkSync(certPath); fs.rmdirSync(directory); });
  const seenSni = [];
  const seenHost = [];
  const server = https.createServer({ key: fixtureKey, cert: fixtureCert, SNICallback(name, callback) {
    seenSni.push(name); callback(null, tls.createSecureContext({ key: fixtureKey, cert: fixtureCert }));
  } }, (req, res) => { seenHost.push(req.headers.host); res.end('secure'); });
  server.on('tlsClientError', () => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const script = `
    const { measureHttp, validateHttpOptions } = require('./dist/httpDiagnostics');
    const { normalizeTarget } = require('./dist/utils');
    (async () => {
      const options = validateHttpOptions({ originIp: '127.0.0.1', originPort: Number(process.argv[1]), samples: 1 });
      const valid = await measureHttp(normalizeTarget('https://customer.invalid:8443/'), options, 'origin', 1);
      const invalid = await measureHttp(normalizeTarget('https://wrong.invalid:8443/'), options, 'origin', 2);
      process.stdout.write(JSON.stringify({ valid, invalid }));
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const result = await promisify(execFile)(process.execPath, ['-e', script, String(server.address().port)], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, NODE_EXTRA_CA_CERTS: certPath }, timeout: 15000
  });
  const { valid, invalid } = JSON.parse(result.stdout);
  assert.equal(valid.outcome, 'complete'); assert.equal(valid.tls.authorized, true);
  assert.equal(valid.bytes, 6); assert.ok(valid.stages.some(stage => stage.stage === 'tls' && stage.completed));
  assert.deepEqual(seenHost, ['customer.invalid:8443']);
  assert.deepEqual(seenSni, ['customer.invalid', 'wrong.invalid']);
  assert.equal(invalid.outcome, 'error'); assert.equal(invalid.failedStage, 'tls');
  assert.match(invalid.error, /ERR_TLS_CERT_ALTNAME_INVALID/);
});
