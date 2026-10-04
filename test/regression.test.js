const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const Module = require('node:module');

const { GlobalpingClient } = require('../dist/globalping');
const { normalizeTarget } = require('../dist/utils');
const { diagnose } = require('../dist/analyzer');

const originalFetch = global.fetch;
test.afterEach(() => { global.fetch = originalFetch; });

function response(body, status = 200, headers = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

test('generated webview script is valid JavaScript', () => {
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'vscode') return {};
    return originalLoad.call(this, request, parent, isMain);
  };
  let CheckerViewProvider;
  try {
    ({ CheckerViewProvider } = require('../dist/webview'));
  } finally {
    Module._load = originalLoad;
  }

  const provider = new CheckerViewProvider({});
  const html = provider.html({ cspSource: 'vscode-webview://test' });
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'inline script was not found');
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(script, /split\(\/\\r\?\\n\|,\//);
  assert.match(script, /if \(running\) return/);
});

test('Globalping transport timeout returns a visible failed detail', async () => {
  global.fetch = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });
  const client = new GlobalpingClient({ country: 'VN', requestTimeoutMs: 20 });
  const result = await client.runSingle('ping', normalizeTarget('google.com'), 'Viettel');
  assert.equal(result.detail.ok, false);
  assert.match(result.detail.summary, /request timed out/i);
});

test('nested API errors such as no matching probe are preserved', async () => {
  global.fetch = async () => response({ error: { type: 'no_probes_found', message: 'No matching IPv4 probes available.' } }, 422);
  const client = new GlobalpingClient({ country: 'VN' });
  const result = await client.runSingle('ping', normalizeTarget('google.com'), 'MobiFone');
  assert.equal(result.detail.ok, false);
  assert.match(result.detail.summary, /Globalping 422: No matching IPv4 probes available/);
});

test('measurement polling is bounded', async () => {
  global.fetch = async (url) => String(url).endsWith('/measurements')
    ? response({ id: 'seed', probesCount: 1 }, 202)
    : response({ id: 'seed', status: 'in-progress', results: [] });
  const client = new GlobalpingClient({ country: 'VN', requestTimeoutMs: 20, measurementTimeoutMs: 30, pollIntervalMs: 5 });
  const result = await client.runSingle('ping', normalizeTarget('google.com'), 'Viettel');
  assert.equal(result.detail.ok, false);
  assert.match(result.detail.summary, /measurement timed out/i);
});

test('remote checks reuse one probe, merge A/AAAA, and expose TCP/TLS', async () => {
  const posts = [];
  const measurements = new Map();
  let id = 0;
  global.fetch = async (url, init = {}) => {
    if (init.method === 'POST') {
      const payload = JSON.parse(init.body);
      posts.push(payload);
      const measurementId = `m${id++}`;
      measurements.set(measurementId, payload);
      return response({ id: measurementId, probesCount: 1 }, 202);
    }
    const measurementId = String(url).split('/').pop();
    const payload = measurements.get(measurementId);
    const probe = { network: 'Viettel Group', asn: 7552, city: 'Hanoi', country: 'VN' };
    let result;
    if (payload.type === 'dns') {
      const recordType = payload.measurementOptions.query.type;
      result = {
        status: 'finished', statusCode: 0, statusCodeName: 'NOERROR', resolver: '1.1.1.1',
        timings: { total: recordType === 'A' ? 5 : 7 },
        answers: [
          { type: 'CNAME', value: 'alias.example' },
          { type: recordType, value: recordType === 'A' ? '142.250.1.1' : '2607:f8b0::1' }
        ],
        rawOutput: `${recordType} output`
      };
    } else if (payload.type === 'ping') {
      result = { status: 'finished', stats: { avg: 12, loss: 0 }, rawOutput: 'ping output' };
    } else {
      result = {
        status: 'finished', statusCode: 200, rawOutput: 'http output', resolvedAddress: '142.250.1.1',
        timings: { total: 40, tcp: 8, tls: 11 },
        tls: {
          authorized: true, protocol: 'TLSv1.3', cipherName: 'TLS_AES_256_GCM_SHA384',
          subject: { CN: '*.google.com' }, issuer: { CN: 'Example CA' }, createdAt: '2026-01-01', expiresAt: '2027-01-01'
        }
      };
    }
    return response({ id: measurementId, status: 'finished', results: [{ probe, result }] });
  };

  const client = new GlobalpingClient({ country: 'VN' });
  const selection = { local: false, remote: true, dns: true, ping: true, http: true, traceroute: false };
  const result = await client.runNetwork(normalizeTarget('https://google.com/search?q=test'), 'Viettel', selection);

  assert.deepEqual(result.dns.data.ipv4, ['142.250.1.1']);
  assert.deepEqual(result.dns.data.ipv6, ['2607:f8b0::1']);
  assert.equal(result.tcp.ok, true);
  assert.equal(result.tls.data.authorized, true);
  assert.equal(result.asn, 7552);
  assert.deepEqual(posts[0].locations, [{ magic: 'VN+Viettel', limit: 1 }]);
  assert.ok(posts.slice(1).every(payload => payload.locations === 'm0'));
  const httpPost = posts.find(payload => payload.type === 'http');
  assert.deepEqual(httpPost.measurementOptions.request, { method: 'GET', path: '/search', query: 'q=test' });
  const tcpPost = posts.find(payload => payload.type === 'ping' && payload.measurementOptions.protocol === 'TCP');
  assert.equal(tcpPost.measurementOptions.port, 443);
});

test('zero probes stop follow-up measurements and remain visible', async () => {
  let posts = 0;
  global.fetch = async () => {
    posts += 1;
    return response({ id: 'empty', probesCount: 0 }, 202);
  };
  const client = new GlobalpingClient({ country: 'VN' });
  const selection = { local: false, remote: true, dns: false, ping: true, http: true, traceroute: true };
  const result = await client.runNetwork(normalizeTarget('google.com'), 'Missing ISP', selection);
  assert.equal(posts, 1);
  assert.match(result.ping.summary, /No matching online probe/);
  assert.match(result.http.summary, /No matching online probe/);
  assert.match(result.traceroute.summary, /No matching online probe/);
});

test('remote TCP failure uses structured TCP measurement without inventing TLS failure', async () => {
  const measurements = new Map();
  let id = 0;
  global.fetch = async (url, init = {}) => {
    if (init.method === 'POST') {
      const payload = JSON.parse(init.body);
      const measurementId = `failure-${id++}`;
      measurements.set(measurementId, payload);
      return response({ id: measurementId, probesCount: 1 }, 202);
    }
    const measurementId = String(url).split('/').pop();
    const payload = measurements.get(measurementId);
    const result = payload.type === 'ping'
      ? { status: 'finished', stats: { avg: null, loss: 100 }, rawOutput: 'TCP connection failed' }
      : { status: 'failed', failureSource: 'target', rawOutput: 'request failed' };
    return response({
      id: measurementId, status: 'finished',
      results: [{
        probe: { network: 'Viettel Group', asn: 7552, city: 'Hanoi', country: 'VN' },
        result
      }]
    });
  };
  const client = new GlobalpingClient({ country: 'VN' });
  const selection = { local: false, remote: true, dns: false, ping: false, http: true, traceroute: false };
  const result = await client.runNetwork(normalizeTarget('google.com'), 'Viettel', selection);
  assert.equal(result.http.ok, false);
  assert.equal(result.tcp.ok, false);
  assert.equal(result.tls, undefined);
  assert.ok(diagnose(result).some(note => note.includes('TCP connection failed')));
});

test('remote TCP failure is diagnosed', () => {
  const notes = diagnose({
    source: 'Viettel', sourceType: 'remote', diagnosis: [],
    dns: { ok: true, summary: 'ok' }, tcp: { ok: false, summary: 'timeout' }
  });
  assert.ok(notes.some(note => note.includes('TCP connection failed')));
});
