import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { convertLog, computeWidths } from './formatter';

type Filters = { include: string[]; exclude: string[] };

function splitWords(s: string | undefined): string[] {
  if (!s) return [];
  return s.split(/[\s]+/).map(w => w.trim().toLowerCase()).filter(Boolean);
}

function applyFilters(lines: string[], f: Filters): string[] {
  const inc = f.include;
  const exc = f.exclude;
  return lines.filter(line => {
    const l = line.toLowerCase();
    // exclude: any match removes
    if (exc.length && exc.some(w => l.includes(w))) return false;
    // include: all must match
    if (inc.length && !inc.every(w => l.includes(w))) return false;
    return true;
  });
}

class LogViewerProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  private cache: Map<string, { original: any[]; formatted: string[]; widths: {widthModule:number;widthCategory:number} }> = new Map();
  private filters: Map<string, Filters> = new Map(); // key: fsPath

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const fsPath = uri.fsPath;
    if (!this.cache.has(fsPath)) {
      const content = fs.readFileSync(fsPath, 'utf8');
      const entries: any[] = [];
      for (const line of content.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        try { entries.push(JSON.parse(t)); } catch { /* ignore */ }
      }
      const widths = computeWidths(entries);
      const formatted = entries.map(e => convertLog(e, widths.widthModule, widths.widthCategory));
      this.cache.set(fsPath, { original: entries, formatted, widths });
      if (!this.filters.has(fsPath)) this.filters.set(fsPath, { include: [], exclude: [] });
    }
    const f = this.filters.get(fsPath)!;
    const formatted = this.cache.get(fsPath)!.formatted;
    const shown = applyFilters(formatted, f);
    return shown.join('\n');
  }

  setFilters(fsPath: string, filter: string, exclude: string) {
    this.filters.set(fsPath, { include: splitWords(filter), exclude: splitWords(exclude) });
    const uri = vscode.Uri.parse(`logviewer:${encodeURIComponent(fsPath)}`);
    this._onDidChange.fire(uri);
  }
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new LogViewerProvider();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('logviewer', provider));

  const ensureOpen = async (uri?: vscode.Uri) => {
    let target = uri;
    if (!target) {
      const active = vscode.window.activeTextEditor?.document.uri;
      if (active && active.scheme === 'file' && active.path.toLowerCase().endsWith('.json')) {
        target = active;
      }
    }
    if (!target) {
      vscode.window.showErrorMessage('Укажите JSON-файл: вызовите команду из контекстного меню проводника.');
      return;
    }
    const vuri = vscode.Uri.parse(`logviewer:${encodeURIComponent(target.path)}`);
    const doc = await vscode.workspace.openTextDocument(vuri);
    await vscode.languages.setTextDocumentLanguage(doc, 'logviewer');
    await vscode.window.showTextDocument(doc, { preview: false });
    return { vuri, fsPath: target.path };
  };

  context.subscriptions.push(vscode.commands.registerCommand('logviewer.open', async (uri?: vscode.Uri) => {
    await ensureOpen(uri);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('logviewer.showFilters', async () => {
    const active = vscode.window.activeTextEditor?.document;
    if (!active || active.uri.scheme !== 'logviewer') {
      vscode.window.showInformationMessage('Откройте лог в LogViewer, затем вызовите Filters.');
      return;
    }
    const fsPath = active.uri.fsPath;

    const panel = vscode.window.createWebviewPanel('logviewerFilters', 'LogViewer Filters', vscode.ViewColumn.Beside, {
      enableScripts: true
    });

    const htmlPath = vscode.Uri.file(path.join(context.extensionPath, 'media', 'panel.html'));
    let html = fs.readFileSync(htmlPath.fsPath, 'utf8');
    panel.webview.html = html;

    panel.webview.postMessage({ type: 'init', filter: '', exclude: '' });

    panel.webview.onDidReceiveMessage(msg => {
      if (msg?.type === 'setFilters') {
        provider.setFilters(fsPath, msg.filter || '', msg.exclude || '');
      }
    });
  }));
}

export function deactivate() {}