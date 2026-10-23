/* Optional real-browser UI check: node test/ui-browser-check.cjs
 * Requires Node >= 22 and Chrome (CHROME_PATH can override its location).
 * Uses a local HTTP fixture and built-in CDP WebSocket; no external test service.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'plans', '261022-diagnostics', 'screenshots');
const source = fs.readFileSync(path.join(root, 'src', 'diagnosticsView.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exported = {};
vm.runInNewContext(compiled, { exports: exported, require });
let html = exported.renderDiagnosticsHtml({ cspSource: "'self'" });
const nonce = html.match(/<script nonce="([^"]+)"/)[1];
const theme = ':root{--vscode-font-family:Segoe UI,sans-serif;--vscode-editor-font-family:Consolas,monospace;--vscode-foreground:#dedede;--vscode-sideBar-background:#202124;--vscode-descriptionForeground:#b8b8b8;--vscode-input-background:#303238;--vscode-input-foreground:#f0f0f0;--vscode-panel-border:#53555b;--vscode-button-background:#126da6;--vscode-button-foreground:#fff;--vscode-button-hoverBackground:#1580bd;--vscode-button-secondaryBackground:#36383e;--vscode-button-secondaryForeground:#f0f0f0;--vscode-button-secondaryHoverBackground:#46484e;--vscode-focusBorder:#70bcec;--vscode-list-activeSelectionBackground:#284a61;--vscode-list-activeSelectionForeground:#fff;--vscode-textCodeBlock-background:#292b30;--vscode-errorForeground:#ff9c9c;--vscode-testing-iconPassed:#9bc890;--vscode-testing-iconFailed:#ff9c9c;--vscode-editorWarning-foreground:#dfbc66}';
html = html.replace('</head>', '<style>' + theme + '</style></head>').replace('<script nonce="' + nonce + '">', '<script nonce="' + nonce + '">window.sent=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.sent.push(m)});');
const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let chrome, socket, profile;
let sequence = 0;
const pending = new Map();
const errors = [];
function cdp(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timed out: ' + method)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
}
const dispatch = (type, payload) => evaluate('window.dispatchEvent(new MessageEvent("message",{data:' + JSON.stringify({ type, payload }) + '}));true');
async function screenshot(name, width, height = 960, scrollTarget) {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await evaluate(scrollTarget ? 'document.querySelector(' + JSON.stringify(scrollTarget) + ').scrollIntoView({block:"start"})' : 'window.scrollTo(0,0)');
  const overflow = await evaluate('document.documentElement.scrollWidth > window.innerWidth');
  assert.equal(overflow, false, 'Page must fit viewport ' + width);
  const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(shot.data, 'base64'));
}
async function main() {
  const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  assert.ok(fs.existsSync(chromePath), 'Chrome missing; set CHROME_PATH');
  fs.mkdirSync(out, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-isp-ui-check-'));
  chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  chrome.on('error', error => errors.push(error.message));
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await wait(100);
  assert.ok(fs.existsSync(portFile), 'Chrome failed to expose DevTools: ' + errors.join('; '));
  const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
  const tab = await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' }).then(r => r.json());
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (process.env.DEBUG_CDP) console.log('CDP', message.id || message.method, message.error || '');
    if (message.id && pending.has(message.id)) { const p = pending.get(message.id); pending.delete(message.id); message.error ? p.reject(new Error(message.error.message)) : p.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  };
  await cdp('Browser.getVersion');
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Page.bringToFront');
  await cdp('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port });
  for (let i = 0; i < 100; i++) { if (await evaluate('!!document.getElementById("run") && typeof window.sent !== "undefined"')) break; await wait(50); }
  assert.deepEqual(await evaluate('window.sent.map(m=>m.type)'), ['loadConfig', 'history']);
  await dispatch('config', { country: 'VN', networks: ['Viettel', 'FPT', 'VNPT'] });
  assert.equal(await evaluate('document.getElementById("stop").disabled'), true);
  await screenshot('legacy-desktop', 1000);
  await screenshot('legacy-320', 320);
  // A bad field in a different mode must not block this form submission.
  await evaluate('document.getElementById("samples").value="0";document.querySelector("[data-mode=dns]").click();document.getElementById("resolver").value="1.1.1.1";document.getElementById("run").click()');
  const dnsMessage = await evaluate('window.sent.at(-1)');
  assert.equal(dnsMessage.type, 'runDiagnostic');
  assert.equal(dnsMessage.payload.mode, 'dns');
  assert.deepEqual(dnsMessage.payload.options.types, ['A', 'AAAA', 'CNAME']);
  assert.equal(dnsMessage.payload.options.resolver, '1.1.1.1');
  assert.equal(await evaluate('document.getElementById("run").disabled && !document.getElementById("stop").disabled && document.getElementById("export").disabled'), true);
  const injection = '<img src=x onerror="window.injected=true">';
  const dnsResult = { id: 'dns-1', mode: 'dns', startedAt: '2026-10-22T10:00:00Z', finishedAt: '2026-10-22T10:00:01Z', dns: { hostname: 'example.com', resolvers: ['1.1.1.1'], cnameChain: ['example.com','edge.example.com'], warnings: [], queries: [{ name: 'example.com', type: 'TXT', status: 'ok', durationMs: 12, records: [{ name: 'example.com', type: 'TXT', value: injection, ttl: 300 }] }] } };
  await dispatch('diagnosticResult', dnsResult);
  assert.equal(await evaluate('document.querySelector("#results img") === null && !window.injected && document.getElementById("results").textContent.includes("<img")'), true);
  assert.equal(await evaluate('!document.getElementById("export").disabled && document.getElementById("importLogs").disabled'), true);
  await screenshot('dns-320', 320);
  await evaluate('document.querySelector("[data-mode=http]").click();document.getElementById("samples").value="3";document.getElementById("method").value="POST";document.getElementById("method").dispatchEvent(new Event("change"));document.getElementById("headers").value=JSON.stringify({"X-Test":"fixture"});document.getElementById("body").value="hello";document.getElementById("originIp").value="127.0.0.1";document.getElementById("originPort").value="8080";document.getElementById("headersMs").value="1700"');
  assert.equal(await evaluate('document.getElementById("writeWarning").hidden'), false);
  await screenshot('http-form-desktop', 1000);
  await screenshot('http-form-320', 320);
  await evaluate('document.getElementById("run").click()');
  const httpMessage = await evaluate('window.sent.at(-1)');
  assert.equal(httpMessage.payload.mode, 'http');
  assert.equal(httpMessage.payload.options.method, 'POST');
  assert.equal(httpMessage.payload.options.headers['X-Test'], 'fixture');
  assert.equal(httpMessage.payload.options.body, 'hello');
  assert.equal(httpMessage.payload.options.originPort, 8080);
  assert.equal(httpMessage.payload.options.timeouts.headersMs, 1700);
  const sample = { index: 1, route: 'public', requestId: 'test-id', startedAt: '2026-10-22T10:00:00Z', outcome: 'timeout', statusCode: 200, failedStage: 'body', timeoutKind: 'bodyIdleMs', totalMs: 10120, headersMs: 120, bytes: 64, remoteAddress: '192.0.2.1', stages: [{ stage: 'dns', startMs: 0, durationMs: 15, completed: true }, { stage: 'tcp', startMs: 15, durationMs: 30, completed: true }, { stage: 'tls', startMs: 45, durationMs: 35, completed: true }, { stage: 'headers', startMs: 80, durationMs: 40, completed: true }, { stage: 'body', startMs: 120, durationMs: 10000, completed: false }], responseHeaders: { 'x-request-id': injection }, tls: { protocol: 'TLSv1.3', authorized: true } };
  await dispatch('sample', sample);
  assert.equal(await evaluate('document.querySelectorAll(".segment.partial").length'), 1);
  assert.equal(await evaluate('document.getElementById("results").textContent.includes("không phải mốc byte đầu chính xác")'), true);
  await evaluate('document.getElementById("stop").click()');
  assert.equal(await evaluate('window.sent.at(-1).type'), 'cancel');
  assert.equal(await evaluate('document.getElementById("stop").disabled'), true);
  const stats = { attempted: 1, completed: 0, timeouts: 1, errors: 0, cancelled: 0, timeoutRate: 1, httpErrorResponses: 0, timeoutResponses: 0 };
  const report = { id: 'http-1', mode: 'http', startedAt: sample.startedAt, finishedAt: '2026-10-22T10:00:11Z', http: { url: 'https://example.com/health', method: 'POST', requestedSamples: 3, samples: [sample], publicStats: stats, warnings: ['Đã dừng trước khi đủ số mẫu.'] }, logMatches: [], logSummary: { imported: 2, matchedRecords: 0, unmatchedRecords: 2 } };
  await dispatch('diagnosticResult', report);
  assert.equal(await evaluate('!document.getElementById("export").disabled && !document.getElementById("importLogs").disabled'), true);
  assert.equal(await evaluate('document.getElementById("results").textContent.includes("Không khớp: 2")'), true);
  assert.equal(await evaluate('document.querySelector("#results img") === null'), true);
  await screenshot('http-result-desktop', 1000, 960, '#results');
  await screenshot('http-result-320', 320, 960, '#results');
  await screenshot('http-timeline-320', 320, 960, '.sample');
  await evaluate('document.getElementById("export").click()');
  assert.deepEqual(await evaluate('window.sent.at(-1)'), { type: 'export', id: 'http-1', format: 'json' });
  await evaluate('document.getElementById("copy").click()');
  assert.equal(await evaluate('window.sent.at(-1).type'), 'copy');
  await evaluate('document.getElementById("importLogs").click()');
  assert.equal(await evaluate('window.sent.at(-1).type'), 'importLogs');
  await dispatch('history', [{ id: 'legacy-1', mode: 'legacy', url: 'https://example.com/', startedAt: sample.startedAt }]);
  await evaluate('document.getElementById("history").value="legacy-1";document.getElementById("history").dispatchEvent(new Event("change"))');
  assert.deepEqual(await evaluate('window.sent.at(-1)'), { type: 'loadRun', id: 'legacy-1' });
  await dispatch('result', { id: 'legacy-1', target: { url: 'https://example.com/' }, startedAt: sample.startedAt, finishedAt: report.finishedAt, comparison: [], results: [] });
  assert.equal(await evaluate('document.querySelector("[data-mode=legacy]").getAttribute("aria-pressed")'), 'true');
  await evaluate('document.getElementById("domain").focus()');
  assert.equal(await evaluate('document.activeElement.id'), 'domain');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  assert.equal(await evaluate('getComputedStyle(document.activeElement).outlineStyle !== "none"'), true);
  await evaluate('document.getElementById("clear").click()');
  assert.equal(await evaluate('document.getElementById("results").textContent'), '');
  assert.equal(await evaluate('document.getElementById("export").disabled'), true);
  assert.deepEqual(errors, []);
  console.log('PASS: real Chrome mode switching, validation, payloads, injection escaping, timelines, cancellation, reports, exports, history, focus, 320px layout.');
  console.log('Screenshots: ' + out);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (socket) { try { await cdp('Browser.close'); } catch {} socket.close(); }
  if (chrome && chrome.exitCode === null) { chrome.kill(); await Promise.race([new Promise(resolve => chrome.once('exit', resolve)), wait(2000)]); }
  server.close();
  // Only remove the unique temporary profile created by this process.
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  if (profile && path.resolve(profile).startsWith(tempRoot) && path.basename(profile).startsWith('multi-isp-ui-check-')) {
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch (error) { console.warn('Temporary Chrome profile cleanup: ' + error.message); }
  }
});
