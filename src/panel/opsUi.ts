import * as vscode from 'vscode';
import type { OpsUi } from '../ops/gitOpsService';

/** GitOpsService'in onay/seçim sorularını VS Code'un modal diyaloğu ve QuickPick'iyle sorar. */
export function createVscodeOpsUi(): OpsUi {
  return {
    async confirm(message: string, detail: string, action: string): Promise<boolean> {
      const choice = await vscode.window.showWarningMessage(message, { modal: true, detail }, action);
      return choice === action;
    },
    async pick<T extends string>(title: string, items: { id: T; label: string; detail?: string }[]): Promise<T | undefined> {
      const picked = await vscode.window.showQuickPick(
        items.map((i) => ({ label: i.label, detail: i.detail, id: i.id })),
        { placeHolder: title, ignoreFocusOut: true },
      );
      return picked?.id;
    },
  };
}
