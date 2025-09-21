import * as vscode from 'vscode';
import { formatLogEntry, getMaxWidthsFromDoc } from './logParser';
import { applyDecorations } from './decorator';

// Открытие всего лога
async function openFullLog() {
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { "JSON logs": ["json", "jsonlog"], "All files": ["*"] },
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
      outLines.push(formatLogEntry(obj, widths, line));
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
      outLines.push(formatLogEntry(obj, widths, line));
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
  vscode.window.visibleTextEditors.forEach(editor => {
    const doc = editor.document;
    if (doc.fileName.endsWith(".jsonlog") || doc.fileName.endsWith(".json")) {
      console.log("[LogViewer] Found already opened .jsonlog on activation:", doc.fileName);
      processJsonLog(doc);
    }
  });

  const statusButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusButton.text = "$(file-text) FormatLog";
  statusButton.command = "logviewer.processCurrentFile";
  statusButton.tooltip = "Форматировать текущий файл лога";
  statusButton.hide();
  context.subscriptions.push(statusButton);

  function updateStatusButton(editor?: vscode.TextEditor) {
    if (!editor) {
      console.log("[LogViewer] Нет активного редактора");
      statusButton.hide();
      return;
    }

    console.log("[LogViewer] Активный файл:", editor.document.fileName);

    if (editor.document.fileName.endsWith(".jsonlog") || editor.document.fileName.endsWith(".json")) {
      console.log("[LogViewer] Показать кнопку для:", editor.document.fileName);
      statusButton.show();
    } else {
      console.log("[LogViewer] Скрыть кнопку для:", editor.document.fileName);
      statusButton.hide();
    }
  }

  // следим за переключением редакторов
  vscode.window.onDidChangeActiveTextEditor(updateStatusButton);

  context.subscriptions.push(
    vscode.commands.registerCommand("logviewer.openLog", openFullLog),

    vscode.commands.registerCommand("logviewer.filterInclude", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const selection = editor.document.getText(editor.selection);
      if (!selection) return vscode.window.showInformationMessage("Выделите текст для фильтрации");
      filterAndFormatLog(selection, undefined);
    }),

    vscode.commands.registerCommand("logviewer.processCurrentFile", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && (editor.document.fileName.endsWith(".jsonlog") || editor.document.fileName.endsWith(".json"))) {
        processJsonLog(editor.document);
      } else {
        vscode.window.showInformationMessage("LogViewer: Откройте .jsonlog файл, чтобы запустить форматирование");
      }
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
    }),

    vscode.workspace.onDidOpenTextDocument(async doc => {
      if (!doc.fileName.endsWith('.jsonlog')) return; // Только исходные файлы
      if (doc.languageId !== 'logviewer') return;

      console.log('[LogViewer] .jsonlog opened, preparing temporary document');

      const widths = getMaxWidthsFromDoc(doc);
      const outLines: string[] = [];

      for (let i = 0; i < doc.lineCount; i++) {
        const line = doc.lineAt(i).text;
        try {
          const obj = JSON.parse(line);
          outLines.push(formatLogEntry(obj, widths, line));
        } catch {
          outLines.push(line);
        }
      }

      // Создаём временный документ без расширения
      const tempDoc = await vscode.workspace.openTextDocument({
        content: outLines.join('\n'),
        language: 'logviewer'
      });

      const tempEditor = await vscode.window.showTextDocument(tempDoc, { preview: false });

      console.log('[LogViewer] Applying decorations to temporary document');
      applyDecorations(tempEditor);

      // Исходный .jsonlog файл остаётся нетронутым
    })

  );
}

async function processJsonLog(doc: vscode.TextDocument) {
  console.log("[LogViewer] Processing .jsonlog:", doc.fileName);

  const widths = getMaxWidthsFromDoc(doc);
  const outLines: string[] = [];

  for (let i = 0; i < doc.lineCount; i++) {
    const line = doc.lineAt(i).text;
    try {
      const obj = JSON.parse(line);
      outLines.push(formatLogEntry(obj, widths, line));
    } catch {
      outLines.push(line);
    }
  }

  const tempDoc = await vscode.workspace.openTextDocument({
    content: outLines.join("\n"),
    language: "logviewer"
  });

  const tempEditor = await vscode.window.showTextDocument(tempDoc, { preview: false });
  console.log("[LogViewer] Decorations applied to temporary document");
  applyDecorations(tempEditor);
}