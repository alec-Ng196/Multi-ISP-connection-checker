const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const httpEngine = require('../dist/httpDiagnostics');
const dnsEngine = require('../dist/dnsDiagnostics');

function host(overrides = {}) {
  const posts = [], copied = [], writes = [], calls = [];
  const vscode = {
    env: { clipboard: { writeText: async text => copied.push(text) } },
    Uri: { file: path => ({ path }) },
    window: { showSaveDialog: async () => ({ path: 'report.json' }), showOpenDialog: async () => [{ path: 'logs.json' }], ...overrides.window },
    workspace: { fs: { stat: async () => ({ size: 100 }), readFile: async () => Buffer.from('[{"requestId":"client-id","status":200}]'), writeFile: async (uri, data) => writes.push({ uri, text: data.toString() }) }, getConfiguration: () => ({ get: (_name, fallback) => fallback }) }
  };
  const runHttpDiagnostics = overrides.runHttpDiagnostics ?? (async (target, options, _signal, progress) => {
    calls.push({ target, options });
    const sample = { index: 1, route: 'public', requestId: 'client-id', startedAt: '2026-01-01', outcome: 'complete', statusCode: 200, totalMs: 1, bytes: 2, stages: [], responseHeaders: {} };
    progress?.(sample);
    return { url: target.url, method: options.method, samples: [sample], requestedSamples: 1, publicStats: httpEngine.summarizeHttp([sample]), warnings: [] };
  });
  const original = Module._load;
  delete require.cache[require.resolve('../dist/webview')];
  let CheckerViewProvider;
  Module._load = function (request, parent, main) {
    if (request === 'vscode') return vscode;
    if (request === './httpDiagnostics') return { ...httpEngine, runHttpDiagnostics };
    if (request === './dnsDiagnostics') return { ...dnsEngine, runDnsDiagnostics: async () => { throw new Error('Unexpected DNS query'); } };
    return original.call(this, request, parent, main);
  };
  try { ({ CheckerViewProvider } = require('../dist/webview')); } finally { Module._load = original; }
  const provider = new CheckerViewProvider({});
  provider.view = { webview: { postMessage: message => posts.push(message) } };
  return { provider, posts, copied, writes, calls };
}

test('webview host validates diagnostics before invoking engines and releases busy on errors', async () => {
  const { provider, posts, calls } = host();
  for (const payload of [{ mode: 'invalid', domain: 'example.test' }, { mode: 'http', domain: 'ftp://example.test' }, { mode: 'http', domain: 'example.test', options: { samples: 100 } }, { mode: 'dns', domain: 'example.test', options: { types: ['ANY'] } }]) {
    await provider.onMessage({ type: 'runDiagnostic', payload });
    assert.equal(provider.busy, false);
    assert.equal(posts.at(-1).type, 'error');
  }
  assert.equal(calls.length, 0);
});

test('webview host suppresses overlapping runs and passes cancellation to active engine', async () => {
  let release, signal;
  let count = 0;
  const { provider, posts } = host({ runHttpDiagnostics: async (_target, _options, runSignal) => {
    count++; signal = runSignal;
    await new Promise(resolve => { release = resolve; });
    return { url: 'https://example.test/', samples: [], publicStats: httpEngine.summarizeHttp([]), warnings: [] };
  } });
  const message = { type: 'runDiagnostic', payload: { mode: 'http', domain: 'example.test', options: {} } };
  const running = provider.onMessage(message);
  assert.equal(provider.busy, true);
  await provider.onMessage(message);
  assert.equal(count, 1);
  assert.equal(posts.at(-1).type, 'notice');
  await provider.onMessage({ type: 'cancel' });
  assert.equal(signal.aborted, true);
  release(); await running;
  assert.equal(provider.busy, false);
  assert.equal(provider.controller, undefined);
});

test('webview history is bounded and excludes request secrets, bodies and query values', async () => {
  const { provider, calls } = host();
  for (let i = 0; i < 12; i++) await provider.onMessage({ type: 'runDiagnostic', payload: { mode: 'http', domain: 'https://example.test/?token=query-secret', options: { method: 'POST', headers: { Authorization: 'Bearer header-secret' }, body: 'body-secret' } } });
  assert.equal(calls.length, 12);
  assert.equal(calls[0].options.headers.authorization, 'Bearer header-secret');
  assert.equal(provider.history.length, 10);
  assert.doesNotMatch(JSON.stringify(provider.history), /query-secret|header-secret|body-secret/);
});

test('webview selected legacy history has its ID and exports/copies the selected report', async () => {
  const { provider, posts, copied, writes } = host();
  const report = { target: { input: 'example.test/?token=secret', url: 'https://example.test/?token=secret', path: '/?token=secret' }, results: [], comparison: [] };
  provider.save({ id: 'legacy-id', mode: 'connectivity', url: report.target.url, startedAt: 'now', report });
  assert.equal(posts.at(-1).payload.id, 'legacy-id');
  await provider.onMessage({ type: 'copy', id: 'legacy-id' });
  await provider.onMessage({ type: 'export', id: 'legacy-id' });
  assert.equal(copied.length, 1);
  assert.equal(writes.length, 1);
  assert.equal(copied[0], writes[0].text);
  assert.doesNotMatch(copied[0], /secret/);
});

test('WAF import completing after a new run starts does not render old result', async () => {
  let finishDialog;
  const { provider, posts } = host({ window: { showOpenDialog: () => new Promise(resolve => { finishDialog = resolve; }) } });
  await provider.onMessage({ type: 'runDiagnostic', payload: { mode: 'http', domain: 'example.test', options: {} } });
  const original = provider.history[0];
  const pending = provider.onMessage({ type: 'importLogs', id: original.id });
  provider.busy = true;
  const before = posts.filter(p => p.type === 'diagnosticResult').length;
  finishDialog([{ path: 'logs.json' }]);
  await pending;
  assert.equal(original.report.logSummary.matchedRecords, 1);
  assert.equal(posts.filter(p => p.type === 'diagnosticResult').length, before);
  assert.equal(provider.busy, true);
});
