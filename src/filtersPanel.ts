// filtersPanel.ts
import * as vscode from 'vscode';
import { filterController } from './filterController';
import { applyDecorations } from './decorator';

export function createFiltersPanel(context: vscode.ExtensionContext) {
  const panel = vscode.window.createWebviewPanel(
    'logFilters',
    'Log Filters',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  const filters = filterController.getCurrentFilters();
  panel.webview.html = getWebviewContent(filters);

  // Принимаем сообщения от вебвью
  panel.webview.onDidReceiveMessage(message => {
    switch (message.command) {
      case 'updateFilters':
        filterController.setFilters(message.include, message.exclude);
        const editor = vscode.window.activeTextEditor;
        if (editor) applyDecorations(editor);
        break;
    }
  });
}

function getWebviewContent(filters: { include?: string, exclude?: string }) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <body>
    <h3>Include Filters</h3>
    <textarea id="include" rows="5" style="width:100%">${filters.include||''}</textarea>
    <h3>Exclude Filters</h3>
    <textarea id="exclude" rows="5" style="width:100%">${filters.exclude||''}</textarea>
    <button onclick="applyFilters()">Apply</button>
    <script>
      const vscode = acquireVsCodeApi();
      function applyFilters() {
        vscode.postMessage({
          command: 'updateFilters',
          include: document.getElementById('include').value,
          exclude: document.getElementById('exclude').value
        });
      }
    </script>
  </body>
  </html>`;
}
