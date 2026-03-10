import * as vscode from 'vscode';
import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';
import * as os from 'os';
import { formatLogEntry, getMaxWidthsFromDoc } from './logParser';
import { applyDecorations, decorationsMap } from './decorator';

// Функция проверки расширения файла на основе настроек пользователя
function isTargetExtension(fileName: string): boolean {
  const config = vscode.workspace.getConfiguration("logviewer");
  const exts = config.get<string[]>("targetExtensions") ||[".jsonlog", ".json"];
  return exts.some(ext => fileName.toLowerCase().endsWith(ext.toLowerCase()));
}

// Асинхронная потоковая обработка огромных файлов (>50MB)
async function processLargeFileStream(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let widthModule = 0;
    let widthCategory = 0;

    // Проход 1: Собираем максимальные ширины
    const rl1 = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity
    });

    rl1.on('line', (line) => {
      try {
        const obj = JSON.parse(line);
        widthModule = Math.max(widthModule, (obj.ModuleName || '').length);
        widthCategory = Math.max(widthCategory, (obj.Category || '').length);
      } catch { }
    });

    rl1.on('close', () => {
      // Проход 2: Форматируем и пишем во временный файл
      const fileName = path.basename(filePath);
      const tempFilePath = path.join(os.tmpdir(), `fmt_${Date.now()}_${fileName}.logviewer`);
      const writeStream = fs.createWriteStream(tempFilePath);

      const rl2 = readline.createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity
      });

      rl2.on('line', (line) => {
        try {
          const obj = JSON.parse(line);
          writeStream.write(formatLogEntry(obj, { widthModule, widthCategory }, line) + '\n');
        } catch {
          writeStream.write(line + '\n');
        }
      });

      rl2.on('close', () => {
        writeStream.end();
        resolve(tempFilePath);
      });

      rl2.on('error', reject);
    });

    rl1.on('error', reject);
  });
}

// Открытие всего лога (диалог)
async function openFullLog() {
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { "All files": ["*"] },
  });
  if (!uris || uris.length === 0) return;

  vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: "LogViewer: Форматирование файла...",
    cancellable: false
  }, async () => {
    const tempFilePath = await processLargeFileStream(uris[0].fsPath);
    const tempDoc = await vscode.workspace.openTextDocument(tempFilePath);
    const editor = await vscode.window.showTextDocument(tempDoc, { preview: false });
    applyDecorations(editor);
  });
}

async function processJsonLog(doc: vscode.TextDocument) {
  console.log("[LogViewer] Processing log:", doc.fileName);

  // Если файл не сохранен физически - используем старый метод (ОЗУ)
  if (doc.isUntitled) {
    const widths = getMaxWidthsFromDoc(doc);
    const outLines: string[] =[];

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
    applyDecorations(tempEditor);

  } else {
    // Для физических файлов используем потоки (защита от краша >50мб файлов)
    vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "LogViewer: Обработка лога...",
      cancellable: false
    }, async () => {
      const tempFilePath = await processLargeFileStream(doc.uri.fsPath);
      const tempDoc = await vscode.workspace.openTextDocument(tempFilePath);
      const editor = await vscode.window.showTextDocument(tempDoc, { preview: false });
      applyDecorations(editor);
    });
  }
}

// Фильтрация
function filterAndFormatLog(include?: string, exclude?: string) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return vscode.window.showErrorMessage('Откройте файл лога');

  const doc = editor.document;
  const widths = getMaxWidthsFromDoc(doc);
  const outLines: string[] =[];

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
  // Обработка при перезапуске VS Code
  vscode.window.visibleTextEditors.forEach(editor => {
    const doc = editor.document;
    // Если это восстановленный сгенерированный лог
    if (doc.languageId === 'logviewer') {
      applyDecorations(editor);
    }
    // Если это целевой файл лога, обрабатываем его
    else if (isTargetExtension(doc.fileName)) {
      console.log("[LogViewer] Found target log on activation:", doc.fileName);
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
      statusButton.hide();
      return;
    }
    if (isTargetExtension(editor.document.fileName)) {
      statusButton.show();
    } else {
      statusButton.hide();
    }
  }

  vscode.window.onDidChangeActiveTextEditor(updateStatusButton);

  // Обработка скролла: красим только видимую зону для защиты от лагов в файлах >50мб
  vscode.window.onDidChangeTextEditorVisibleRanges(e => {
    if (e.textEditor.document.languageId === 'logviewer') {
      applyDecorations(e.textEditor);
    }
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("logviewer.openLog", openFullLog),
    vscode.commands.registerCommand("logviewer.filterInclude", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const selection = editor.document.getText(editor.selection);
      if (!selection) return vscode.window.showInformationMessage("Выделите текст");
      filterAndFormatLog(selection, undefined);
    }),
    vscode.commands.registerCommand("logviewer.processCurrentFile", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && isTargetExtension(editor.document.fileName)) {
        processJsonLog(editor.document);
      } else {
        vscode.window.showInformationMessage("LogViewer: Откройте целевой файл лога");
      }
    }),
    vscode.commands.registerCommand("logviewer.filterExclude", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const selection = editor.document.getText(editor.selection);
      if (!selection) return vscode.window.showInformationMessage("Выделите текст");
      filterAndFormatLog(undefined, selection);
    }),

    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration("logviewer")) {
        Object.values(decorationsMap).forEach(dec => dec.dispose());
        for (const key in decorationsMap) delete decorationsMap[key];

        vscode.window.visibleTextEditors.forEach(editor => {
          if (editor.document.languageId === 'logviewer') applyDecorations(editor);
        });
      }
    }),

    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (!editor) return;
      if (editor.document.languageId === 'logviewer') {
        applyDecorations(editor);
      }
    }),

    vscode.workspace.onDidOpenTextDocument(async doc => {
      if (doc.languageId === 'logviewer') return; // Игнорируем уже отформатированные
      if (!isTargetExtension(doc.fileName)) return; // Проверка по настройкам

      console.log('[LogViewer] Target log opened, preparing document');
      processJsonLog(doc);
    })
  );
}