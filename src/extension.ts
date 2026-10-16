import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('rewiewrev.refresh', () => undefined),
  );
}

export function deactivate(): void {}
