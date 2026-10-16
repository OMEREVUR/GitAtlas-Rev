import './base.css';
import type { ExtensionToWebview, WebviewToExtension } from '../protocol';

interface VsCodeApi {
  postMessage(msg: WebviewToExtension): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
window.addEventListener('message', (e: MessageEvent<ExtensionToWebview>) => {
  void e.data;
});
vscode.postMessage({ type: 'ready' });
