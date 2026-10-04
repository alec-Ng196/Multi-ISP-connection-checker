import * as vscode from 'vscode';
import { CheckerViewProvider } from './webview';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new CheckerViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CheckerViewProvider.viewType, provider),
    vscode.commands.registerCommand('multiIspChecker.runTest', () => provider.focusAndRun())
  );
}

export function deactivate(): void {}
