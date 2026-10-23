"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CheckerViewProvider = void 0;
const vscode = __importStar(require("vscode"));
const node_crypto_1 = require("node:crypto");
const utils_1 = require("./utils");
const localTester_1 = require("./localTester");
const globalping_1 = require("./globalping");
const analyzer_1 = require("./analyzer");
const dnsDiagnostics_1 = require("./dnsDiagnostics");
const httpDiagnostics_1 = require("./httpDiagnostics");
const diagnosticsView_1 = require("./diagnosticsView");
const wafLogs_1 = require("./wafLogs");
const reports_1 = require("./reports");
class CheckerViewProvider {
    context;
    static viewType = 'multiIspChecker.view';
    view;
    busy = false;
    controller;
    history = [];
    selectedId;
    constructor(context) {
        this.context = context;
    }
    resolveWebviewView(webviewView) {
        this.view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.html(webviewView.webview);
        webviewView.webview.onDidReceiveMessage(message => { void this.onMessage(message); });
        webviewView.onDidDispose(() => { this.controller?.abort(); this.view = undefined; });
        this.postConfig();
        this.postHistory();
    }
    async focusAndRun() {
        await vscode.commands.executeCommand('multiIspChecker.view.focus');
        this.view?.show(true);
        this.post('focusDomain');
    }
    post(type, payload) { this.view?.webview.postMessage({ type, payload }); }
    postConfig() {
        const cfg = vscode.workspace.getConfiguration('multiIspChecker');
        this.post('config', { country: cfg.get('country', 'VN'), networks: cfg.get('remoteNetworks', ['Viettel', 'FPT', 'VNPT', 'MobiFone']) });
    }
    postHistory() {
        this.post('history', this.history.map(({ id, mode, url, startedAt }) => ({ id, mode, url, startedAt })));
    }
    save(run) {
        const safe = (0, reports_1.sanitizeReport)(run);
        this.history = [safe, ...this.history.filter(item => item.id !== run.id)].slice(0, 10);
        this.selectedId = run.id;
        this.postHistory();
        this.showRun(safe);
    }
    showRun(run) {
        this.selectedId = run.id;
        this.post(run.mode === 'connectivity' ? 'result' : 'diagnosticResult', { ...run.report, id: run.id });
    }
    getRun(id) {
        const run = this.history.find(item => item.id === (typeof id === 'string' ? id : this.selectedId));
        if (!run)
            throw new Error('Chưa có kết quả. Chạy phép đo hoặc chọn lịch sử trước.');
        return run;
    }
    async onMessage(message) {
        if (!message || typeof message.type !== 'string')
            return;
        try {
            switch (message.type) {
                case 'loadConfig':
                    this.postConfig();
                    this.postHistory();
                    break;
                case 'history':
                    this.postHistory();
                    break;
                case 'cancel':
                    this.controller?.abort();
                    break;
                case 'run':
                    await this.withRun(() => this.handleRun(message.payload));
                    break;
                case 'runDiagnostic':
                    await this.withRun(() => this.handleDiagnostic(message.payload));
                    break;
                case 'loadRun':
                    if (!this.busy)
                        this.showRun(this.getRun(message.id));
                    break;
                case 'copy':
                    await vscode.env.clipboard.writeText(JSON.stringify(this.getRun(message.id).report, null, 2));
                    this.post('notice', 'Đã sao chép JSON; giá trị query trong URL đã được ẩn.');
                    break;
                case 'export':
                    await this.exportRun(message.id);
                    break;
                case 'importLogs':
                    if (!this.busy)
                        await this.importLogs(message.id);
                    break;
            }
        }
        catch (error) {
            this.post('notice', 'Lỗi: ' + (0, utils_1.errorMessage)(error));
        }
    }
    async withRun(action) {
        if (this.busy) {
            this.post('notice', 'Đang chạy phép đo. Hãy chờ hoặc dừng trước.');
            return;
        }
        this.busy = true;
        try {
            await action();
        }
        catch (error) {
            this.post('error', (0, utils_1.errorMessage)(error));
        }
        finally {
            this.busy = false;
            this.controller = undefined;
        }
    }
    async handleDiagnostic(input) {
        if (!input || !['dns', 'http'].includes(input.mode))
            throw new Error('Chọn chế độ DNS records hoặc HTTP / WAF.');
        if (typeof input.domain !== 'string' || input.domain.length > 8192)
            throw new Error('Domain / URL không hợp lệ.');
        const target = (0, utils_1.normalizeTarget)(input.domain);
        const dnsOptions = input.mode === 'dns' ? (0, dnsDiagnostics_1.validateDnsOptions)(input.options) : undefined;
        const httpOptions = input.mode === 'http' ? (0, httpDiagnostics_1.validateHttpOptions)(input.options) : undefined;
        this.controller = new AbortController();
        const run = { id: (0, node_crypto_1.randomUUID)(), mode: input.mode, startedAt: new Date().toISOString(), finishedAt: '' };
        this.post('progress', input.mode === 'dns' ? 'Đang truy vấn DNS records…' : 'Đang đo HTTP từ máy chạy extension…');
        if (dnsOptions)
            run.dns = await (0, dnsDiagnostics_1.runDnsDiagnostics)(target.hostname, dnsOptions, this.controller.signal);
        if (httpOptions)
            run.http = await (0, httpDiagnostics_1.runHttpDiagnostics)(target, httpOptions, this.controller.signal, sample => {
                this.post('sample', (0, reports_1.sanitizeReport)(sample));
                this.post('progress', 'Mẫu ' + sample.index + ' · ' + (sample.route === 'origin' ? 'Client → origin' : 'URL công khai') + ' · ' + sample.outcome + ' · ' + Math.round(sample.totalMs) + ' ms');
            });
        run.finishedAt = new Date().toISOString();
        this.save({ id: run.id, mode: run.mode, url: target.url, startedAt: run.startedAt, report: run });
    }
    async handleRun(request) {
        if (!request || typeof request.domain !== 'string' || request.domain.length > 8192 || !request.selection)
            throw new Error('Dữ liệu phép đo không hợp lệ.');
        const target = (0, utils_1.normalizeTarget)(request.domain);
        const selection = {};
        for (const key of ['local', 'remote', 'dns', 'ping', 'http', 'traceroute'])
            selection[key] = request.selection[key] === true;
        if (!selection.local && !selection.remote)
            throw new Error('Chọn Local và/hoặc Remote probes.');
        if (![selection.dns, selection.ping, selection.http, selection.traceroute].some(Boolean))
            throw new Error('Chọn ít nhất một loại kiểm tra.');
        const networks = Array.isArray(request.networks) ? [...new Set(request.networks.filter(v => typeof v === 'string').map(v => v.trim()).filter(Boolean))] : [];
        if (selection.remote && (!networks.length || networks.length > 8 || networks.some(v => v.length > 100)))
            throw new Error('Nhập từ 1 đến 8 mạng, mỗi tên tối đa 100 ký tự.');
        const cfg = vscode.workspace.getConfiguration('multiIspChecker');
        const country = cfg.get('country', 'VN').toUpperCase();
        const timeoutMs = Math.max(1000, Math.min(30000, cfg.get('timeoutMs', 8000)));
        const token = process.env.GLOBALPING_TOKEN || cfg.get('globalpingToken', '') || undefined;
        const startedAt = new Date().toISOString();
        const results = [];
        if (selection.local) {
            this.post('progress', 'Đang kiểm tra kết nối local…');
            results.push(await (0, localTester_1.runLocalTests)(target, selection, timeoutMs));
        }
        if (selection.remote) {
            const client = new globalping_1.GlobalpingClient({ country, token });
            this.post('progress', 'Đang kiểm tra Globalping từ ' + networks.length + ' mạng…');
            results.push(...await Promise.all(networks.map(network => client.runNetwork(target, network, selection))));
        }
        const response = (0, analyzer_1.finalize)({ target, startedAt, finishedAt: new Date().toISOString(), results, comparison: [] });
        this.save({ id: (0, node_crypto_1.randomUUID)(), mode: 'connectivity', url: target.url, startedAt, report: response });
    }
    async exportRun(id) {
        const run = this.getRun(id);
        const destination = await vscode.window.showSaveDialog({ saveLabel: 'Xuất JSON', filters: { JSON: ['json'] }, defaultUri: vscode.Uri.file('multi-isp-' + run.mode + '-' + run.id.slice(0, 8) + '.json') });
        if (!destination)
            return;
        await vscode.workspace.fs.writeFile(destination, Buffer.from(JSON.stringify(run.report, null, 2), 'utf8'));
        this.post('notice', 'Đã xuất JSON; không lưu request headers/body và đã ẩn giá trị query của URL.');
    }
    async importLogs(id) {
        const run = this.getRun(id);
        if (run.mode !== 'http')
            throw new Error('Chọn một kết quả HTTP / WAF trước khi nhập log.');
        const selected = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Nhập log JSON / JSONL', filters: { 'JSON logs': ['json', 'jsonl', 'ndjson'] } });
        if (!selected?.[0])
            return;
        const stat = await vscode.workspace.fs.stat(selected[0]);
        if (stat.size > 2 * 1024 * 1024)
            throw new Error('Log tối đa 2 MiB.');
        const logs = (0, wafLogs_1.parseWafLogs)(Buffer.from(await vscode.workspace.fs.readFile(selected[0])).toString('utf8'));
        const report = run.report;
        const result = (0, wafLogs_1.correlateWafLogs)(report.http.samples, logs);
        report.logMatches = result.matches;
        report.logSummary = { imported: logs.length, matchedRecords: result.matchedRecords, unmatchedRecords: result.unmatchedRecords };
        if (!this.busy && this.selectedId === run.id)
            this.showRun(run);
        this.post('notice', 'Khớp ' + result.matchedRecords + '/' + logs.length + ' bản ghi theo request ID. ID không có hoặc trùng nhiều mẫu không được gán timing. Các số là do log cung cấp, không phải phép đo WAF → origin của tool.');
    }
    html(webview) { return (0, diagnosticsView_1.renderDiagnosticsHtml)(webview); }
}
exports.CheckerViewProvider = CheckerViewProvider;
//# sourceMappingURL=webview.js.map