"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderDiagnosticsHtml = renderDiagnosticsHtml;
const crypto_1 = require("crypto");
/** Self-contained, theme-aware webview. Request secrets are never stored in webview state. */
function renderDiagnosticsHtml(webview) {
    const nonce = (0, crypto_1.randomBytes)(18).toString('hex');
    return String.raw `<!DOCTYPE html>
<html lang="vi"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>Multi-ISP Domain Checker</title>
<style>
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin:0; padding:16px; color:var(--vscode-foreground); background:var(--vscode-sideBar-background); font:13px/1.5 var(--vscode-font-family); }
main { max-width:1100px; margin:auto; }
h1 { font-size:17px; font-weight:600; margin:0 0 4px; } h2 { font-size:15px; margin:18px 0 8px; } h3 { font-size:13px; margin:12px 0 6px; }
p { margin:6px 0 12px; } .hint,.meta { color:var(--vscode-descriptionForeground); font-size:12px; } .mono,pre { font-family:var(--vscode-editor-font-family); }
label { display:block; margin:8px 0 4px; } .check { display:inline-flex; align-items:center; gap:6px; margin:0; min-height:30px; }
input,textarea,select,button { font:inherit; } input:not([type=checkbox]),textarea,select { width:100%; min-width:0; background:var(--vscode-input-background); color:var(--vscode-input-foreground); border:1px solid var(--vscode-input-border,var(--vscode-panel-border)); border-radius:2px; padding:7px 8px; }
textarea { min-height:72px; resize:vertical; } input[type=checkbox] { accent-color:var(--vscode-focusBorder); }
button { cursor:pointer; min-height:34px; border:1px solid transparent; border-radius:2px; padding:6px 10px; background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); }
button:hover { background:var(--vscode-button-secondaryHoverBackground); } button:disabled { opacity:.5; cursor:default; }
button.primary { background:var(--vscode-button-background); color:var(--vscode-button-foreground); } button.primary:hover { background:var(--vscode-button-hoverBackground); }
:focus-visible { outline:2px solid var(--vscode-focusBorder); outline-offset:2px; }
.modes { display:flex; flex-wrap:wrap; gap:6px; margin:16px 0; } .modes button { flex:1 1 auto; } .modes button[aria-pressed=true] { border-color:var(--vscode-focusBorder); background:var(--vscode-list-activeSelectionBackground); color:var(--vscode-list-activeSelectionForeground); }
fieldset { border:0; margin:0; padding:0; min-width:0; } .row { display:flex; flex-wrap:wrap; gap:8px 14px; margin:8px 0; } .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:0 12px; }
.actions { display:flex; flex-wrap:wrap; gap:8px; padding:14px 0; border-bottom:1px solid var(--vscode-panel-border); } .actions .primary { flex:1; }
.tools { display:flex; flex-wrap:wrap; gap:6px; margin:10px 0; } .tools button { font-size:12px; }
details { margin:10px 0; } summary { cursor:pointer; padding:4px 0; } .note { border-left:3px solid var(--vscode-focusBorder); padding:5px 10px; margin:10px 0; } .error { color:var(--vscode-errorForeground); }
#status { min-height:24px; margin:10px 0; overflow-wrap:anywhere; } #results { overflow-wrap:anywhere; } .source,.sample,.route { border-top:1px solid var(--vscode-panel-border); padding:10px 0; }
.test { display:grid; grid-template-columns:70px minmax(0,1fr); gap:8px; margin:8px 0; } .ok { color:var(--vscode-testing-iconPassed); } .bad { color:var(--vscode-testing-iconFailed); }
pre { white-space:pre-wrap; overflow-wrap:anywhere; font-size:12px; padding:10px; background:var(--vscode-textCodeBlock-background); max-height:300px; overflow:auto; }
ul { margin:6px 0; padding-left:20px; } .table-wrap { overflow:auto; } table { border-collapse:collapse; width:100%; font-size:12px; } th,td { text-align:left; vertical-align:top; padding:7px 6px; border-bottom:1px solid var(--vscode-panel-border); } th { font-weight:600; } td { overflow-wrap:anywhere; }
.metrics { display:flex; flex-wrap:wrap; gap:10px 20px; margin:8px 0; } .metrics div { min-width:70px; } .metrics strong { display:block; font-size:17px; font-variant-numeric:tabular-nums; } .metrics span { font-size:12px; color:var(--vscode-descriptionForeground); }
.timeline { display:flex; gap:2px; height:10px; margin:8px 0; overflow:hidden; background:var(--vscode-input-background); } .segment { background:var(--vscode-focusBorder); min-width:2px; opacity:.8; } .segment.partial { background:var(--vscode-editorWarning-foreground); border:1px dashed var(--vscode-foreground); } .stages { display:flex; flex-wrap:wrap; gap:4px 12px; font-size:12px; font-variant-numeric:tabular-nums; }
[hidden] { display:none !important; } @media(max-width:360px) { body { padding:10px; } .modes button { flex-basis:100%; } .test { grid-template-columns:1fr; gap:2px; } }
</style></head><body><main>
<h1>Multi-ISP Domain Checker</h1><p class="hint">Kiểm tra đường kết nối, bản ghi DNS và thời gian request.</p>
<nav class="modes" aria-label="Chế độ kiểm tra">
<button type="button" data-mode="legacy" aria-pressed="true">Kết nối đa ISP</button><button type="button" data-mode="dns" aria-pressed="false">DNS records</button><button type="button" data-mode="http" aria-pressed="false">HTTP / WAF</button>
</nav>
<form id="requestForm"><fieldset id="inputs">
<label for="domain">Domain / URL</label><input id="domain" type="text" placeholder="https://example.com/api/health" value="https://example.com/" required autocomplete="off" spellcheck="false">
<section id="panel-legacy" aria-label="Kết nối đa ISP">
<div class="row"><label class="check"><input id="local" type="checkbox" checked>Local</label><label class="check"><input id="remote" type="checkbox" checked>Remote probes</label></div>
<label for="networks">Mạng remote — mỗi dòng một mạng</label><textarea id="networks" spellcheck="false">Viettel
FPT
VNPT
MobiFone</textarea><p id="countryHint" class="hint">Globalping: VN + tên mạng. Một số mạng có thể không có probe online.</p>
<div class="row"><label class="check"><input id="dns" type="checkbox" checked>DNS</label><label class="check"><input id="ping" type="checkbox" checked>Ping</label><label class="check"><input id="http" type="checkbox" checked>HTTP/TLS</label><label class="check"><input id="traceroute" type="checkbox">Traceroute</label></div>
<p class="hint">Traceroute thường chậm hơn và dùng thêm lượt đo Globalping. Chế độ này chưa hỗ trợ dừng giữa chừng.</p></section>
<section id="panel-dns" hidden aria-label="Tra cứu DNS records"><h2>Loại bản ghi</h2>
<div class="row" id="recordTypes">${['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'CAA', 'SRV'].map(t => `<label class="check"><input type="checkbox" name="recordType" value="${t}"${['A', 'AAAA', 'CNAME'].includes(t) ? ' checked' : ''}>${t}</label>`).join('')}</div>
<div class="grid"><div><label for="resolver">DNS resolver (tùy chọn)</label><input id="resolver" type="text" placeholder="1.1.1.1" spellcheck="false"></div><div><label for="dnsTimeout">Timeout mỗi truy vấn (ms)</label><input id="dnsTimeout" type="number" value="5000" min="100" max="30000" step="100"></div></div>
<div class="row"><label class="check"><input id="followCname" type="checkbox" checked>Theo chuỗi CNAME</label></div><p class="hint">Bỏ trống resolver để dùng DNS của máy chạy extension. SRV cần tên đầy đủ như _sip._tcp.example.com. TTL chỉ hiển thị khi resolver trả về.</p></section>
<section id="panel-http" hidden aria-label="Đo HTTP / WAF"><p class="note">Đo từ máy chạy extension tới URL công khai. Với Cloudrity, kết quả không tách được thời gian WAF → backend nếu không có log tương ứng.</p>
<div class="grid"><div><label for="method">Method</label><select id="method">${['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].map(m => `<option>${m}</option>`).join('')}</select></div><div><label for="samples">Số mẫu / mỗi đường</label><input id="samples" type="number" value="3" min="1" max="50"></div><div><label for="interval">Nghỉ giữa mẫu (ms)</label><input id="interval" type="number" value="500" min="100" max="60000" step="100"></div></div>
<p id="writeWarning" class="note" hidden>POST/PUT/PATCH/DELETE gửi request thật, lặp lại theo số mẫu; nếu thêm origin, gửi cả hai đường. Có thể thay đổi dữ liệu khách hàng.</p>
<details><summary>Headers và request body</summary><label for="headers">Headers — JSON object</label><textarea id="headers" class="mono" spellcheck="false" placeholder='{"Accept":"application/json"}'>{}</textarea><label for="body">Request body</label><textarea id="body" class="mono" spellcheck="false"></textarea><p class="hint">Headers và body chỉ dùng cho lượt đo, không được lưu vào trạng thái giao diện.</p></details>
<details><summary>Ngưỡng timeout và giới hạn tải</summary><p class="hint">Đơn vị ms. Tổng là deadline toàn request; chờ body là khoảng im lặng giữa các chunk.</p><div class="grid">
${[['dnsMs', 'DNS', '5000'], ['connectMs', 'Kết nối TCP', '8000'], ['tlsMs', 'Bắt tay TLS', '8000'], ['headersMs', 'Chờ headers', '30000'], ['bodyIdleMs', 'Chờ body', '10000'], ['totalMs', 'Tổng request', '60000']].map(([id, label, value]) => `<div><label for="${id}">${label} (ms)</label><input id="${id}" type="number" value="${value}" min="100" max="300000" step="100"></div>`).join('')}
<div><label for="maxBytes">Giới hạn body (byte)</label><input id="maxBytes" type="number" value="2097152" min="1024" max="10485760"></div></div></details>
<details><summary>So sánh trực tiếp origin (tùy chọn)</summary><p class="hint">Đây là client → origin, không phải WAF → origin. Giữ Host/SNI của URL. Chỉ dùng khi máy của bạn truy cập được origin.</p><label for="originIp">IP origin</label><input id="originIp" type="text" placeholder="IP backend khách hàng" spellcheck="false"><label for="originPort">Cổng origin (trống = cổng URL)</label><input id="originPort" type="number" min="1" max="65535"></details>
<p class="hint">Mỗi mẫu dùng kết nối mới; không tự theo redirect. 408/504 là phản hồi HTTP, được thống kê riêng với timeout do máy đo tự ngắt.</p></section>
</fieldset><div class="actions"><button id="run" class="primary" type="submit">Kiểm tra kết nối</button><button id="stop" type="button" disabled>Dừng</button><button id="clear" type="button">Xóa kết quả</button></div></form>
<div id="status" role="status" aria-live="polite"></div>
<label for="history">Lịch sử phiên — tối đa 10 lượt</label><select id="history"><option value="">Chọn lượt đo đã hoàn tất</option></select>
<div class="tools"><button id="export" disabled>Export JSON</button><button id="copy" disabled>Copy JSON</button><button id="importLogs" disabled>Nhập log WAF</button></div>
<section id="results" aria-label="Kết quả"><p class="hint">Chọn chế độ và bấm kiểm tra để bắt đầu.</p></section>
</main><script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const $ = id => document.getElementById(id);
const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list = values => '<ul>' + (values || []).map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>';
const ms = value => Number.isFinite(value) ? Math.round(value * 10) / 10 + ' ms' : '—';
const number = id => Number($(id).value);
const stageNames = {dns:'DNS',tcp:'TCP',tls:'TLS',upload:'Gửi request',headers:'Chờ headers',body:'Tải body'};
let mode = 'legacy', running = false, currentId, completedMode, received = 0;
function controls() {
  $('inputs').disabled = running;
  ['legacy','dns','http'].forEach(m => document.querySelectorAll('#panel-' + m + ' input, #panel-' + m + ' select, #panel-' + m + ' textarea').forEach(input => input.disabled = m !== mode));
  document.querySelectorAll('[data-mode]').forEach(b => { b.disabled = running; b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); });
  $('run').disabled = running; $('clear').disabled = running; $('history').disabled = running;
  $('stop').disabled = !running || mode === 'legacy';
  $('run').textContent = running ? 'Đang đo…' : ({legacy:'Kiểm tra kết nối',dns:'Tra cứu DNS',http:'Đo HTTP / WAF'}[mode]);
  $('export').disabled = running || !completedMode; $('copy').disabled = running || !completedMode; $('importLogs').disabled = running || completedMode !== 'http';
}
function setMode(value) { mode = value; ['legacy','dns','http'].forEach(m => $('panel-' + m).hidden = m !== mode); controls(); }
function status(message, error) { $('status').textContent = message; $('status').className = error ? 'error' : ''; }
function rawDetails(title, value) { return '<details><summary>' + esc(title) + '</summary><pre>' + esc(typeof value === 'string' ? value : JSON.stringify(value, null, 2)) + '</pre></details>'; }
function renderTest(name, detail) {
  if (!detail) return '';
  return '<div class="test"><strong>' + esc(name) + '</strong><div><span class="' + (detail.ok ? 'ok' : 'bad') + '">' + (detail.ok ? 'OK · ' : 'Lỗi · ') + esc(detail.summary) + '</span> · ' + ms(detail.latencyMs) + (detail.raw ? rawDetails('Raw output',detail.raw) : '') + (detail.data ? rawDetails('Structured data',detail.data) : '') + '</div></div>';
}
function renderLegacy(p) {
  let html = '<h2>' + esc(p.target.url) + '</h2><p class="meta">' + esc(p.startedAt) + '</p>' + list(p.comparison);
  for (const r of p.results) {
    html += '<section class="source"><h3>' + esc(r.source) + ' · ' + esc(r.sourceType) + '</h3><p class="meta">' + esc([r.network,r.asn ? 'AS' + r.asn : '',r.location].filter(Boolean).join(' · ')) + '</p>';
    ['dns','tcp','tls','http','ping','traceroute'].forEach(t => html += renderTest(t.toUpperCase(),r[t]));
    html += '<h3>Diagnosis</h3>' + list(r.diagnosis) + '</section>';
  }
  $('results').innerHTML = html;
}
function renderDns(p) {
  const d = p.dns;
  let html = '<h2>DNS · ' + esc(d.hostname) + '</h2><p class="meta">Resolver: ' + esc(d.resolvers.join(', ')) + '</p>' + list(d.warnings);
  if (d.cnameChain.length) html += '<h3>Chuỗi CNAME</h3><p class="mono">' + d.cnameChain.map(esc).join(' → ') + '</p>';
  html += '<div class="table-wrap"><table><caption>Bản ghi và trạng thái từng truy vấn</caption><thead><tr><th>Tên / loại</th><th>Giá trị</th><th>TTL (s)</th><th>Trạng thái</th></tr></thead><tbody>';
  for (const q of d.queries) {
    const records = q.records.length ? q.records : [{name:q.name,type:q.type,value:q.error || 'Không có bản ghi'}];
    for (const r of records) html += '<tr><td>' + esc(r.name) + '<br><strong>' + esc(r.type) + '</strong></td><td class="mono">' + esc(r.value) + '</td><td>' + esc(r.ttl === undefined ? '—' : r.ttl) + '</td><td>' + esc(q.status) + '<br>' + ms(q.durationMs) + '</td></tr>';
  }
  return html + '</tbody></table></div><p class="hint">Không có dữ liệu cho một loại record không đồng nghĩa domain không tồn tại.</p>';
}
function metric(label,value) { return '<div><strong>' + esc(value) + '</strong><span>' + esc(label) + '</span></div>'; }
function stats(title,s) {
  if (!s) return '';
  return '<section class="route"><h3>' + esc(title) + '</h3><div class="metrics">' + metric('Đã thử',s.attempted) + metric('Hoàn tất',s.completed) + metric('Timeout máy đo',s.timeouts) + metric('Tỷ lệ timeout',(s.timeoutRate * 100).toFixed(1) + '%') + metric('p50',ms(s.p50Ms)) + metric('p95',ms(s.p95Ms)) + metric('p99',ms(s.p99Ms)) + '</div><p class="hint">Percentile chỉ tính mẫu tải hoàn tất, kể cả HTTP lỗi. HTTP 408/504: ' + esc(s.timeoutResponses) + ' · HTTP ≥ 400: ' + esc(s.httpErrorResponses) + ' · Lỗi đo: ' + esc(s.errors) + ' · Đã dừng: ' + esc(s.cancelled) + '</p></section>';
}
function sample(s) {
  const outcome = {complete:'Hoàn tất',timeout:'Timeout máy đo',error:'Lỗi',cancelled:'Đã dừng',limit:'Chạm giới hạn body'}[s.outcome] || s.outcome;
  const total = Math.max(1,s.totalMs);
  let html = '<article class="sample"><h3>Mẫu ' + esc(s.index) + ' · ' + (s.route === 'origin' ? 'Client → origin' : 'URL công khai') + ' · ' + esc(outcome) + '</h3><p>' + (s.statusCode ? 'HTTP ' + esc(s.statusCode) + ' · ' : '') + ms(s.totalMs) + ' · ' + esc(s.bytes) + ' byte</p>';
  if (Number.isFinite(s.headersMs)) html += '<p class="hint">Nhận headers sau ' + ms(s.headersMs) + ' từ lúc bắt đầu; không phải mốc byte đầu chính xác.</p>';
  html += '<div class="timeline" aria-hidden="true">' + s.stages.map(t => '<span class="segment' + (t.completed ? '' : ' partial') + '" style="flex-grow:' + Math.max(0,Math.min(100,Number(t.durationMs) / total * 100) || 0) + '"></span>').join('') + '</div>';
  html += '<div class="stages">' + s.stages.map(t => '<span>' + esc(stageNames[t.stage] || t.stage) + ': ' + ms(t.durationMs) + (t.completed ? '' : ' (chưa hoàn tất)') + '</span>').join('') + '</div>';
  if (s.error || s.failedStage) html += '<p class="error">' + esc(s.error || '') + (s.failedStage ? ' · Tại: ' + esc(stageNames[s.failedStage] || s.failedStage) : '') + (s.timeoutKind ? ' · ' + esc(s.timeoutKind) : '') + '</p>';
  html += '<p class="meta">Request ID: <span class="mono">' + esc(s.requestId) + '</span>' + (s.remoteAddress ? '<br>IP: ' + esc(s.remoteAddress) : '') + '</p>' + rawDetails('Response headers / IDs',s.responseHeaders);
  if (s.tls) html += rawDetails('TLS / chứng chỉ',s.tls);
  return html + '</article>';
}
function renderDiagnostic(p) {
  let html;
  if (p.mode === 'dns') html = renderDns(p);
  else {
    html = '<h2>' + esc(p.http.method) + ' ' + esc(p.http.url) + '</h2>' + list(p.http.warnings) + stats('Client → URL công khai',p.http.publicStats) + stats('Client → origin (đường độc lập)',p.http.originStats);
    html += '<p class="note">Thời gian chờ headers gồm truyền mạng và xử lý phía server/WAF/backend; không tự suy ra thời gian nội bộ Cloudrity. Mẫu timeout chỉ cho biết đã chờ tới ngưỡng đặt.</p>' + p.http.samples.map(sample).join('');
    if (p.logMatches) html += '<h3>Đối chiếu log WAF</h3><p class="hint">Timing do log nhập vào báo cáo, ghép theo request ID. Không tính chênh lệch hai đường thành overhead WAF.</p>' + (p.logMatches.length ? rawDetails('Các log khớp request ID',p.logMatches) : '<p>Không có request ID khớp.</p>');
    if (p.logSummary) html += '<p>Log đã nhập: ' + esc(p.logSummary.imported) + ' · Khớp: ' + esc(p.logSummary.matchedRecords) + ' · Không khớp: ' + esc(p.logSummary.unmatchedRecords) + '</p>';
  }
  $('results').innerHTML = html + rawDetails('Structured data',p);
}
function run(event) {
  if (event) event.preventDefault(); if (running) return;
  const domain = $('domain').value.trim(); if (!domain) { status('Nhập domain hoặc URL.',true); $('domain').focus(); return; }
  let message;
  try {
    if (mode === 'legacy') {
      const selection = {}; ['local','remote','dns','ping','http','traceroute'].forEach(k => selection[k] = $(k).checked);
      if (!selection.local && !selection.remote) throw new Error('Chọn Local hoặc Remote.');
      if (!['dns','ping','http','traceroute'].some(k => selection[k])) throw new Error('Chọn ít nhất một phép kiểm tra.');
      message = {type:'run',payload:{domain,networks:$('networks').value.split(/\r?\n|,/).map(v => v.trim()).filter(Boolean),selection}};
    } else if (mode === 'dns') {
      const types = Array.from(document.querySelectorAll('[name=recordType]:checked')).map(i => i.value);
      if (!types.length) throw new Error('Chọn ít nhất một loại DNS record.');
      message = {type:'runDiagnostic',payload:{mode,domain,options:{types,resolver:$('resolver').value.trim() || undefined,timeoutMs:number('dnsTimeout'),followCname:$('followCname').checked}}};
    } else {
      let headers; try { headers = JSON.parse($('headers').value || '{}'); } catch { throw new Error('Headers phải là JSON object hợp lệ.'); }
      if (!headers || Array.isArray(headers) || typeof headers !== 'object' || Object.values(headers).some(v => typeof v !== 'string')) throw new Error('Headers phải là object với giá trị chuỗi.');
      const timeouts = {}; ['dnsMs','connectMs','tlsMs','headersMs','bodyIdleMs','totalMs'].forEach(k => timeouts[k] = number(k));
      message = {type:'runDiagnostic',payload:{mode,domain,options:{method:$('method').value,headers,body:$('body').value,samples:number('samples'),intervalMs:number('interval'),timeouts,maxBytes:number('maxBytes'),originIp:$('originIp').value.trim() || undefined,originPort:$('originPort').value ? number('originPort') : undefined}}};
    }
  } catch (error) { status(error.message,true); return; }
  running = true; completedMode = undefined; currentId = undefined; received = 0; controls(); $('results').innerHTML = ''; status('Đang bắt đầu…'); vscode.postMessage(message);
}
$('requestForm').addEventListener('submit',run);
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click',() => setMode(b.dataset.mode)));
$('method').addEventListener('change',() => $('writeWarning').hidden = !['POST','PUT','PATCH','DELETE'].includes($('method').value));
$('stop').addEventListener('click',() => { vscode.postMessage({type:'cancel'}); $('stop').disabled = true; status('Đang dừng; giữ lại các mẫu đã đo…'); });
$('clear').addEventListener('click',() => { $('results').innerHTML = ''; status(''); currentId = undefined; completedMode = undefined; $('history').value = ''; controls(); });
['export','copy','importLogs'].forEach(type => $(type).addEventListener('click',() => vscode.postMessage({type,id:currentId,format:type === 'export' ? 'json' : undefined})));
$('history').addEventListener('change',() => { if ($('history').value) vscode.postMessage({type:'loadRun',id:$('history').value}); });
window.addEventListener('message',event => {
  const msg = event.data;
  if (msg.type === 'config') {
    if (Array.isArray(msg.payload.networks)) $('networks').value = msg.payload.networks.join('\n');
    $('countryHint').textContent = 'Globalping: ' + msg.payload.country + ' + tên mạng. Có thể không có probe online.';
  } else if (msg.type === 'progress') status(msg.payload);
  else if (msg.type === 'sample') { received++; $('results').insertAdjacentHTML('beforeend',sample(msg.payload)); status('Đã nhận ' + received + ' mẫu; đang tiếp tục…'); }
  else if (msg.type === 'result') { running = false; currentId = msg.payload.id; completedMode = 'legacy'; setMode('legacy'); renderLegacy(msg.payload); controls(); status('Đã hoàn tất kiểm tra kết nối. Xem trạng thái từng phép đo bên dưới.'); vscode.postMessage({type:'history'}); }
  else if (msg.type === 'diagnosticResult') { running = false; currentId = msg.payload.id; completedMode = msg.payload.mode; setMode(msg.payload.mode); renderDiagnostic(msg.payload); controls(); status('Đã kết thúc lượt đo. Kết quả giữ cả mẫu lỗi, timeout hoặc đã dừng.'); vscode.postMessage({type:'history'}); }
  else if (msg.type === 'history') { const selected = currentId || ''; $('history').innerHTML = '<option value="">Chọn lượt đo đã hoàn tất</option>' + msg.payload.slice(0,10).map(r => '<option value="' + esc(r.id) + '">' + esc(r.startedAt + ' · ' + r.mode + ' · ' + r.url) + '</option>').join(''); $('history').value = selected; }
  else if (msg.type === 'error') { running = false; controls(); status(msg.payload,true); }
  else if (msg.type === 'notice') status(msg.payload);
  else if (msg.type === 'focusDomain') { $('domain').focus(); $('domain').select(); }
});
controls(); vscode.postMessage({type:'loadConfig'}); vscode.postMessage({type:'history'});
</script></body></html>`;
}
//# sourceMappingURL=diagnosticsView.js.map