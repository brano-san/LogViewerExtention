import * as vscode from 'vscode';
import { filterController } from './filterController';
import { formatLogEntry, getMaxWidthsFromDoc } from './logParser';
import { applyDecorations } from './decorator';

// Открытие всего лога
async function openFullLog() {
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { "JSON logs": ["json"], "All files": ["*"] },
  });
  if (!uris || uris.length === 0) return;

  const doc = await vscode.workspace.openTextDocument(uris[0]);
  const widths = getMaxWidthsFromDoc(doc);
  const outLines: string[] = [];

  for (let i = 0; i < doc.lineCount; i++) {
    const line = doc.lineAt(i).text;
    if (!line) {
      outLines.push("");
      continue;
    }
    try {
      const obj = JSON.parse(line);
      outLines.push(formatLogEntry(obj, widths));
    } catch {
      outLines.push(line);
    }
  }

  const formattedDoc = await vscode.workspace.openTextDocument({
    content: outLines.join("\n"),
    language: "logviewer",
  });
  await vscode.window.showTextDocument(formattedDoc, { preview: false });

  // Подсветка
  const editor = vscode.window.activeTextEditor;
  if (editor) applyDecorations(editor);
}

// Фильтрация
function filterAndFormatLog(include?: string, exclude?: string) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return vscode.window.showErrorMessage('Откройте файл лога');

  const doc = editor.document;
  const widths = getMaxWidthsFromDoc(doc);
  const outLines: string[] = [];

  for (let i = 0; i < doc.lineCount; i++) {
    const line = doc.lineAt(i).text;
    if (!line) continue;

    if (include && !line.includes(include)) continue;
    if (exclude && line.includes(exclude)) continue;

    try {
      const obj = JSON.parse(line);
      outLines.push(formatLogEntry(obj, widths));
    } catch {
      outLines.push(line);
    }
  }

  vscode.workspace.openTextDocument({
    content: outLines.join("\n"),
    language: "logviewer",
  }).then(doc => vscode.window.showTextDocument(doc, { preview: false }))
    .then(editor => applyDecorations(editor));
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("logviewer.openLog", openFullLog),
    vscode.commands.registerCommand("logviewer.filterInclude", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const selection = editor.document.getText(editor.selection);
      if (!selection) return vscode.window.showInformationMessage("Выделите текст для фильтрации");
      filterAndFormatLog(selection, undefined);
    }),
    vscode.commands.registerCommand("logviewer.filterExclude", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const selection = editor.document.getText(editor.selection);
      if (!selection) return vscode.window.showInformationMessage("Выделите текст для исключения");
      filterAndFormatLog(undefined, selection);
    }),
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (!editor) return;
      if (editor.document.languageId === 'logviewer') {
        applyDecorations(editor);
      }
    })
  );
}
