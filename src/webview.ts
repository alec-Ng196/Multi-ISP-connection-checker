import * as vscode from 'vscode';
import { RunRequest, RunResponse } from './types';
import { normalizeTarget } from './utils';
import { runLocalTests } from './localTester';
import { GlobalpingClient } from './globalping';
import { finalize } from './analyzer';

export class CheckerViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'multiIspChecker.view';
  private view?: vscode.WebviewView;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.html(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(async message => {
      if (message?.type === 'run') await this.handleRun(message.payload as RunRequest);
      if (message?.type === 'loadConfig') this.postConfig();
    });
    this.postConfig();
  }

  public focusAndRun(): void {
    this.view?.show?.(true);
    this.view?.webview.postMessage({ type: 'focusDomain' });
  }

  private postConfig(): void {
    if (!this.view) return;
    const cfg = vscode.workspace.getConfiguration('multiIspChecker');
    this.view.webview.postMessage({
      type: 'config',
      payload: {
        country: cfg.get<string>('country', 'VN'),
        networks: cfg.get<string[]>('remoteNetworks', ['Viettel', 'FPT', 'VNPT', 'MobiFone'])
      }
    });
  }

  private async handleRun(request: RunRequest): Promise<void> {
    if (!this.view) return;
    const webview = this.view.webview;
    try {
      const target = normalizeTarget(request.domain);
      const cfg = vscode.workspace.getConfiguration('multiIspChecker');
      const country = cfg.get<string>('country', 'VN').toUpperCase();
      const timeoutMs = cfg.get<number>('timeoutMs', 8000);
      const token = process.env.GLOBALPING_TOKEN || cfg.get<string>('globalpingToken', '') || undefined;
      const networks = (request.networks || []).map(v => v.trim()).filter(Boolean).slice(0, 8);
      if (!request.selection.local && !request.selection.remote) throw new Error('Select Local and/or Remote tests.');
      if (![request.selection.dns, request.selection.ping, request.selection.http, request.selection.traceroute].some(Boolean)) {
        throw new Error('Select at least one test type.');
      }

      webview.postMessage({ type: 'progress', payload: 'Starting tests…' });
      const startedAt = new Date().toISOString();
      const results = [];

      if (request.selection.local) {
        webview.postMessage({ type: 'progress', payload: 'Running local checks…' });
        results.push(await runLocalTests(target, request.selection, timeoutMs));
      }

      if (request.selection.remote) {
        if (!networks.length) throw new Error('Add at least one remote network.');
        const client = new GlobalpingClient({ country, token });
        webview.postMessage({ type: 'progress', payload: `Running Globalping checks for ${networks.length} network(s)…` });
        const remoteResults = await Promise.all(networks.map(network => client.runNetwork(target, network, request.selection)));
        results.push(...remoteResults);
      }

      const response = finalize({
        target,
        startedAt,
        finishedAt: new Date().toISOString(),
        results,
        comparison: []
      });
      webview.postMessage({ type: 'result', payload: response });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      webview.postMessage({ type: 'error', payload: message });
      vscode.window.showErrorMessage(`Multi-ISP Checker: ${message}`);
    }
  }

  private html(webview: vscode.Webview): string {
    const nonce = String(Date.now());
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  :root { color-scheme: light dark; }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; margin: 0; }
  h2 { font-size: 15px; margin: 0 0 10px; }
  h3 { font-size: 13px; margin: 14px 0 8px; }
  label { display: block; font-size: 12px; margin: 8px 0 4px; }
  input[type=text], textarea { width: 100%; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 7px 8px; border-radius: 2px; }
  textarea { min-height: 74px; resize: vertical; }
  .row { display: flex; flex-wrap: wrap; gap: 8px 12px; margin: 8px 0; }
  .check { display: inline-flex; gap: 6px; align-items: center; font-size: 12px; }
  button { border: 0; padding: 8px 12px; cursor: pointer; border-radius: 2px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: .55; cursor: default; }
  .secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .hint, .meta { color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.45; }
  #status { margin: 10px 0; font-size: 12px; min-height: 18px; }
  .error { color: var(--vscode-errorForeground); }
  .summary { border: 1px solid var(--vscode-panel-border); padding: 8px; margin: 8px 0 12px; border-radius: 3px; }
  .source { border-top: 1px solid var(--vscode-panel-border); padding: 10px 0; }
  .source:first-child { border-top: 0; }
  .source-title { font-weight: 600; display: flex; gap: 6px; flex-wrap: wrap; }
  .badge { font-size: 10px; padding: 1px 5px; border-radius: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .test { display: grid; grid-template-columns: 82px 1fr; gap: 6px; margin: 5px 0; font-size: 12px; }
  .ok { color: var(--vscode-testing-iconPassed, #4caf50); }
  .bad { color: var(--vscode-testing-iconFailed, #f44336); }
  details { margin: 5px 0; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 10px; background: var(--vscode-textCodeBlock-background); padding: 7px; max-height: 260px; overflow: auto; }
  ul { margin: 5px 0 0 18px; padding: 0; font-size: 12px; }
</style>
</head>
<body>
  <h2>Multi-ISP Domain Checker</h2>
  <label for="domain">Domain / URL</label>
  <input id="domain" type="text" placeholder="https://example.com/" value="https://example.com/">

  <div class="row">
    <label class="check"><input id="local" type="checkbox" checked> Local</label>
    <label class="check"><input id="remote" type="checkbox" checked> Remote probes</label>
  </div>

  <label for="networks">Remote networks (one per line)</label>
  <textarea id="networks">Viettel\nFPT\nVNPT\nMobiFone</textarea>
  <div id="countryHint" class="hint">Globalping filter: VN + network name. A network may have no online probe at a given time.</div>

  <h3>Checks</h3>
  <div class="row">
    <label class="check"><input id="dns" type="checkbox" checked> DNS</label>
    <label class="check"><input id="ping" type="checkbox" checked> Ping</label>
    <label class="check"><input id="http" type="checkbox" checked> HTTP/TLS</label>
    <label class="check"><input id="traceroute" type="checkbox"> Traceroute</label>
  </div>
  <p class="hint">Traceroute is off by default because it is slower and consumes additional Globalping tests.</p>

  <div class="row">
    <button id="run">Run test</button>
    <button id="clear" class="secondary" type="button">Clear results</button>
  </div>
  <div id="status" role="status" aria-live="polite"></div>
  <div id="results"></div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
let running = false;

function selected() {
  return {
    local: $('local').checked,
    remote: $('remote').checked,
    dns: $('dns').checked,
    ping: $('ping').checked,
    http: $('http').checked,
    traceroute: $('traceroute').checked
  };
}

function run() {
  if (running) return;
  const domain = $('domain').value.trim();
  if (!domain) { $('status').innerHTML = '<span class="error">Enter a domain or URL.</span>'; return; }
  const networks = $('networks').value.split(/\\r?\\n|,/).map(v => v.trim()).filter(Boolean);
  running = true;
  $('run').disabled = true;
  $('status').textContent = 'Starting…';
  $('results').innerHTML = '';
  vscode.postMessage({ type: 'run', payload: { domain, networks, selection: selected() } });
}

function renderTest(name, detail) {
  if (!detail) return '';
  const cls = detail.ok ? 'ok' : 'bad';
  const icon = detail.ok ? '✓' : '✕';
  const latency = Number.isFinite(detail.latencyMs) ? ' · ' + Math.round(detail.latencyMs) + ' ms' : '';
  const raw = detail.raw ? '<details><summary>Raw output</summary><pre>' + esc(detail.raw) + '</pre></details>' : '';
  const data = detail.data && Object.keys(detail.data).length ? '<details><summary>Structured data</summary><pre>' + esc(JSON.stringify(detail.data, null, 2)) + '</pre></details>' : '';
  return '<div class="test"><div>' + esc(name) + '</div><div><span class="' + cls + '">' + icon + ' ' + esc(detail.summary) + '</span>' + latency + raw + data + '</div></div>';
}

function render(payload) {
  let html = '<div class="summary"><strong>' + esc(payload.target.url) + '</strong><div class="meta">' + esc(payload.startedAt) + ' → ' + esc(payload.finishedAt) + '</div>';
  html += '<ul>' + payload.comparison.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></div>';
  for (const r of payload.results) {
    const probe = [r.network, r.asn ? 'AS' + r.asn : '', r.location].filter(Boolean).join(' · ');
    html += '<section class="source"><div class="source-title">' + esc(r.source) + ' <span class="badge">' + esc(r.sourceType) + '</span></div>';
    if (probe) html += '<div class="meta">' + esc(probe) + '</div>';
    html += renderTest('DNS', r.dns);
    html += renderTest('TCP', r.tcp);
    html += renderTest('TLS', r.tls);
    html += renderTest('HTTP', r.http);
    html += renderTest('Ping', r.ping);
    html += renderTest('Traceroute', r.traceroute);
    html += '<h3>Diagnosis</h3><ul>' + (r.diagnosis || []).map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></section>';
  }
  $('results').innerHTML = html;
}

$('run').addEventListener('click', run);
$('domain').addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
$('clear').addEventListener('click', () => { $('results').innerHTML = ''; $('status').textContent = ''; });
window.addEventListener('message', event => {
  const msg = event.data;
  if (msg.type === 'config') {
    if (Array.isArray(msg.payload.networks)) $('networks').value = msg.payload.networks.join('\\n');
    $('countryHint').textContent = 'Globalping filter: ' + msg.payload.country + ' + network name. A network may have no online probe at a given time.';
  } else if (msg.type === 'progress') {
    $('status').textContent = msg.payload;
  } else if (msg.type === 'result') {
    running = false;
    $('run').disabled = false;
    const failed = msg.payload.results.reduce((count, result) => count +
      ['dns', 'tcp', 'tls', 'http', 'ping', 'traceroute'].filter(name => result[name] && !result[name].ok).length, 0);
    $('status').textContent = failed ? 'Finished with ' + failed + ' failed check(s).' : 'Finished.';
    render(msg.payload);
  } else if (msg.type === 'error') {
    running = false;
    $('run').disabled = false;
    $('status').innerHTML = '<span class="error">' + esc(msg.payload) + '</span>';
  } else if (msg.type === 'focusDomain') {
    $('domain').focus();
    $('domain').select();
  }
});
vscode.postMessage({ type: 'loadConfig' });
</script>
</body>
</html>`;
  }
}
