import * as vscode from 'vscode';
import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';
import * as os from 'os';
import { formatLogEntry, getMaxWidthsFromDoc } from './logParser';
import { applyDecorations, decorationsMap } from './decorator';
import { LFSProvider } from './lfsProvider';

function isTargetExtension(fileName: string): boolean {
  const config = vscode.workspace.getConfiguration("logviewer");
  const exts = config.get<string[]>("targetExtensions") || [".jsonlog", ".json"];
  return exts.some(ext => fileName.toLowerCase().endsWith(ext.toLowerCase()));
}

async function processLargeFileStream(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let widthModule = 0;
    let widthCategory = 0;

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

// Умное открытие с проверкой лимита VS Code (>50мб)
async function openDocumentWithLfsCheck(filePath: string) {
  const stat = fs.statSync(filePath);
  const isLarge = stat.size > 50 * 1024 * 1024; // 50MB

  const uri = isLarge
    ? vscode.Uri.file(filePath).with({ scheme: 'logviewer-lfs' })
    : vscode.Uri.file(filePath);

  const doc = await vscode.workspace.openTextDocument(uri);
  vscode.languages.setTextDocumentLanguage(doc, 'logviewer');

  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  applyDecorations(editor);
}

async function openFullLog() {
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { "All files": ["*"] },
  });
  if (!uris || uris.length === 0) return;

  vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: "LogViewer: Обработка файла...",
    cancellable: false
  }, async () => {
    const tempFilePath = await processLargeFileStream(uris[0].fsPath);
    await openDocumentWithLfsCheck(tempFilePath);
  });
}

async function processJsonLog(doc: vscode.TextDocument) {
  console.log("[LogViewer] Processing log:", doc.fileName);

  if (doc.isUntitled) {
    // Для несохраненных вкладок берём данные прямо из ОЗУ
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
    applyDecorations(tempEditor);

  } else {
    // Это физический файл на диске
    const fsPath = doc.uri.fsPath;

    vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "LogViewer: Форматирование (чтение потоком)...",
      cancellable: false
    }, async () => {
      const tempFilePath = await processLargeFileStream(fsPath);
      await openDocumentWithLfsCheck(tempFilePath);
    });
  }
}

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
  const lfsProvider = new LFSProvider();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('logviewer-lfs', lfsProvider, { isReadonly: true, isCaseSensitive: true })
  );

  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((doc) => {
    if (doc.uri.scheme === 'logviewer-lfs') lfsProvider.onDidCloseTextDocument(doc.uri);
  }));

  vscode.window.visibleTextEditors.forEach(editor => {
    const doc = editor.document;
    if (doc.fileName.endsWith('.logviewer') || doc.uri.scheme === 'logviewer-lfs') {
      applyDecorations(editor);
    } else if (isTargetExtension(doc.fileName)) {
      processJsonLog(doc);
    }
  });

  const statusButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusButton.text = "$(file-text) FormatLog";
  statusButton.command = "logviewer.processCurrentFile";
  statusButton.hide();
  context.subscriptions.push(statusButton);

  vscode.window.onDidChangeActiveTextEditor(editor => {
    if (!editor) { statusButton.hide(); return; }
    if (isTargetExtension(editor.document.fileName)) statusButton.show();
    else statusButton.hide();

    if (editor.document.languageId === 'logviewer' || editor.document.uri.scheme === 'logviewer-lfs') {
      applyDecorations(editor);
    }
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("logviewer.openLog", openFullLog),
    vscode.commands.registerCommand("logviewer.filterInclude", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const selection = editor.document.getText(editor.selection);
      if (selection) filterAndFormatLog(selection, undefined);
    }),
    vscode.commands.registerCommand("logviewer.processCurrentFile", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && isTargetExtension(editor.document.fileName)) processJsonLog(editor.document);
    }),
    vscode.commands.registerCommand("logviewer.filterExclude", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const selection = editor.document.getText(editor.selection);
      if (selection) filterAndFormatLog(undefined, selection);
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

    vscode.workspace.onDidOpenTextDocument(async doc => {
      // 1. Игнорируем временные отформатированные файлы на диске
      if (doc.fileName.endsWith('.logviewer')) return;
      // 2. Игнорируем файлы, открытые через обходчик больших файлов
      if (doc.uri.scheme === 'logviewer-lfs') return;
      // 3. Игнорируем файлы, которые мы генерируем из ОЗУ
      if (doc.isUntitled && doc.languageId === 'logviewer') return;

      // Теперь проверяем, является ли это файл целевым (например, .jsonlog)
      if (!isTargetExtension(doc.fileName)) return;

      processJsonLog(doc);
    })
  );
}