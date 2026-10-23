import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { RunRequest, RunResponse, TestSelection } from './types';
import { DiagnosticRun } from './diagnosticsTypes';
import { normalizeTarget, errorMessage } from './utils';
import { runLocalTests } from './localTester';
import { GlobalpingClient } from './globalping';
import { finalize } from './analyzer';
import { runDnsDiagnostics, validateDnsOptions } from './dnsDiagnostics';
import { runHttpDiagnostics, validateHttpOptions } from './httpDiagnostics';
import { renderDiagnosticsHtml } from './diagnosticsView';
import { correlateWafLogs, parseWafLogs } from './wafLogs';
import { sanitizeReport } from './reports';

interface SavedRun { id: string; mode: 'connectivity' | 'dns' | 'http'; url: string; startedAt: string; report: RunResponse | DiagnosticRun; }

export class CheckerViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'multiIspChecker.view';
  private view?: vscode.WebviewView;
  private busy = false;
  private controller?: AbortController;
  private history: SavedRun[] = [];
  private selectedId?: string;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.html(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(message => { void this.onMessage(message); });
    webviewView.onDidDispose(() => { this.controller?.abort(); this.view = undefined; });
    this.postConfig();
    this.postHistory();
  }

  public async focusAndRun(): Promise<void> {
    await vscode.commands.executeCommand('multiIspChecker.view.focus');
    this.view?.show(true);
    this.post('focusDomain');
  }

  private post(type: string, payload?: unknown): void { this.view?.webview.postMessage({ type, payload }); }

  private postConfig(): void {
    const cfg = vscode.workspace.getConfiguration('multiIspChecker');
    this.post('config', { country: cfg.get<string>('country', 'VN'), networks: cfg.get<string[]>('remoteNetworks', ['Viettel', 'FPT', 'VNPT', 'MobiFone']) });
  }

  private postHistory(): void {
    this.post('history', this.history.map(({ id, mode, url, startedAt }) => ({ id, mode, url, startedAt })));
  }

  private save(run: SavedRun): void {
    const safe = sanitizeReport(run);
    this.history = [safe, ...this.history.filter(item => item.id !== run.id)].slice(0, 10);
    this.selectedId = run.id;
    this.postHistory();
    this.showRun(safe);
  }

  private showRun(run: SavedRun): void {
    this.selectedId = run.id;
    this.post(run.mode === 'connectivity' ? 'result' : 'diagnosticResult', { ...run.report, id: run.id });
  }

  private getRun(id?: unknown): SavedRun {
    const run = this.history.find(item => item.id === (typeof id === 'string' ? id : this.selectedId));
    if (!run) throw new Error('Chưa có kết quả. Chạy phép đo hoặc chọn lịch sử trước.');
    return run;
  }

  private async onMessage(message: any): Promise<void> {
    if (!message || typeof message.type !== 'string') return;
    try {
      switch (message.type) {
        case 'loadConfig': this.postConfig(); this.postHistory(); break;
        case 'history': this.postHistory(); break;
        case 'cancel': this.controller?.abort(); break;
        case 'run': await this.withRun(() => this.handleRun(message.payload)); break;
        case 'runDiagnostic': await this.withRun(() => this.handleDiagnostic(message.payload)); break;
        case 'loadRun': if (!this.busy) this.showRun(this.getRun(message.id)); break;
        case 'copy':
          await vscode.env.clipboard.writeText(JSON.stringify(this.getRun(message.id).report, null, 2));
          this.post('notice', 'Đã sao chép JSON; giá trị query trong URL đã được ẩn.');
          break;
        case 'export': await this.exportRun(message.id); break;
        case 'importLogs': if (!this.busy) await this.importLogs(message.id); break;
      }
    } catch (error) {
      this.post('notice', 'Lỗi: ' + errorMessage(error));
    }
  }

  private async withRun(action: () => Promise<void>): Promise<void> {
    if (this.busy) { this.post('notice', 'Đang chạy phép đo. Hãy chờ hoặc dừng trước.'); return; }
    this.busy = true;
    try { await action(); }
    catch (error) { this.post('error', errorMessage(error)); }
    finally { this.busy = false; this.controller = undefined; }
  }

  private async handleDiagnostic(input: any): Promise<void> {
    if (!input || !['dns', 'http'].includes(input.mode)) throw new Error('Chọn chế độ DNS records hoặc HTTP / WAF.');
    if (typeof input.domain !== 'string' || input.domain.length > 8192) throw new Error('Domain / URL không hợp lệ.');
    const target = normalizeTarget(input.domain);
    const dnsOptions = input.mode === 'dns' ? validateDnsOptions(input.options) : undefined;
    const httpOptions = input.mode === 'http' ? validateHttpOptions(input.options) : undefined;
    this.controller = new AbortController();
    const run: DiagnosticRun = { id: randomUUID(), mode: input.mode, startedAt: new Date().toISOString(), finishedAt: '' };
    this.post('progress', input.mode === 'dns' ? 'Đang truy vấn DNS records…' : 'Đang đo HTTP từ máy chạy extension…');
    if (dnsOptions) run.dns = await runDnsDiagnostics(target.hostname, dnsOptions, this.controller.signal);
    if (httpOptions) run.http = await runHttpDiagnostics(target, httpOptions, this.controller.signal, sample => {
      this.post('sample', sanitizeReport(sample));
      this.post('progress', 'Mẫu ' + sample.index + ' · ' + (sample.route === 'origin' ? 'Client → origin' : 'URL công khai') + ' · ' + sample.outcome + ' · ' + Math.round(sample.totalMs) + ' ms');
    });
    run.finishedAt = new Date().toISOString();
    this.save({ id: run.id, mode: run.mode, url: target.url, startedAt: run.startedAt, report: run });
  }

  private async handleRun(request: RunRequest): Promise<void> {
    if (!request || typeof request.domain !== 'string' || request.domain.length > 8192 || !request.selection) throw new Error('Dữ liệu phép đo không hợp lệ.');
    const target = normalizeTarget(request.domain);
    const selection = {} as TestSelection;
    for (const key of ['local', 'remote', 'dns', 'ping', 'http', 'traceroute'] as const) selection[key] = request.selection[key] === true;
    if (!selection.local && !selection.remote) throw new Error('Chọn Local và/hoặc Remote probes.');
    if (![selection.dns, selection.ping, selection.http, selection.traceroute].some(Boolean)) throw new Error('Chọn ít nhất một loại kiểm tra.');
    const networks = Array.isArray(request.networks) ? [...new Set(request.networks.filter(v => typeof v === 'string').map(v => v.trim()).filter(Boolean))] : [];
    if (selection.remote && (!networks.length || networks.length > 8 || networks.some(v => v.length > 100))) throw new Error('Nhập từ 1 đến 8 mạng, mỗi tên tối đa 100 ký tự.');
    const cfg = vscode.workspace.getConfiguration('multiIspChecker');
    const country = cfg.get<string>('country', 'VN').toUpperCase();
    const timeoutMs = Math.max(1000, Math.min(30000, cfg.get<number>('timeoutMs', 8000)));
    const token = process.env.GLOBALPING_TOKEN || cfg.get<string>('globalpingToken', '') || undefined;
    const startedAt = new Date().toISOString();
    const results = [];
    if (selection.local) {
      this.post('progress', 'Đang kiểm tra kết nối local…');
      results.push(await runLocalTests(target, selection, timeoutMs));
    }
    if (selection.remote) {
      const client = new GlobalpingClient({ country, token });
      this.post('progress', 'Đang kiểm tra Globalping từ ' + networks.length + ' mạng…');
      results.push(...await Promise.all(networks.map(network => client.runNetwork(target, network, selection))));
    }
    const response = finalize({ target, startedAt, finishedAt: new Date().toISOString(), results, comparison: [] });
    this.save({ id: randomUUID(), mode: 'connectivity', url: target.url, startedAt, report: response });
  }

  private async exportRun(id?: unknown): Promise<void> {
    const run = this.getRun(id);
    const destination = await vscode.window.showSaveDialog({ saveLabel: 'Xuất JSON', filters: { JSON: ['json'] }, defaultUri: vscode.Uri.file('multi-isp-' + run.mode + '-' + run.id.slice(0, 8) + '.json') });
    if (!destination) return;
    await vscode.workspace.fs.writeFile(destination, Buffer.from(JSON.stringify(run.report, null, 2), 'utf8'));
    this.post('notice', 'Đã xuất JSON; không lưu request headers/body và đã ẩn giá trị query của URL.');
  }

  private async importLogs(id?: unknown): Promise<void> {
    const run = this.getRun(id);
    if (run.mode !== 'http') throw new Error('Chọn một kết quả HTTP / WAF trước khi nhập log.');
    const selected = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Nhập log JSON / JSONL', filters: { 'JSON logs': ['json', 'jsonl', 'ndjson'] } });
    if (!selected?.[0]) return;
    const stat = await vscode.workspace.fs.stat(selected[0]);
    if (stat.size > 2 * 1024 * 1024) throw new Error('Log tối đa 2 MiB.');
    const logs = parseWafLogs(Buffer.from(await vscode.workspace.fs.readFile(selected[0])).toString('utf8'));
    const report = run.report as DiagnosticRun;
    const result = correlateWafLogs(report.http!.samples, logs);
    report.logMatches = result.matches;
    report.logSummary = { imported: logs.length, matchedRecords: result.matchedRecords, unmatchedRecords: result.unmatchedRecords };
    if (!this.busy && this.selectedId === run.id) this.showRun(run);
    this.post('notice', 'Khớp ' + result.matchedRecords + '/' + logs.length + ' bản ghi theo request ID. ID không có hoặc trùng nhiều mẫu không được gán timing. Các số là do log cung cấp, không phải phép đo WAF → origin của tool.');
  }

  private html(webview: vscode.Webview): string { return renderDiagnosticsHtml(webview); }
}
