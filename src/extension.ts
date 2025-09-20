import * as vscode from 'vscode';
import { applyDecorations } from './decorator';
import { filterController } from './filterController';
import { formatLogEntry } from './logParser';

export function getMaxWidthsFromDoc(doc: import('vscode').TextDocument) {
  let widthModule = 0;
  let widthCategory = 0;

  for (let i = 0; i < doc.lineCount; i++) {
    const line = doc.lineAt(i).text;
    try {
      const obj = JSON.parse(line);
      widthModule = Math.max(widthModule, (obj.ModuleName || '').length);
      widthCategory = Math.max(widthCategory, (obj.Category || '').length);
    } catch {
      // игнорируем строки, которые не JSON
    }
  }

  return { widthModule, widthCategory };
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("logviewer.openLog", async () => {
      // 1) выбираем файл через диалог
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { "JSON logs": ["json"], "All files": ["*"] },
      });
      if (!uris || uris.length === 0) return;

      const doc = await vscode.workspace.openTextDocument(uris[0]);

      // 2) считаем ширины по всему документу
      const widths = getMaxWidthsFromDoc(doc);

      // 3) форматируем все строки
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

      // 4) открываем новый документ с форматированным выводом
      const formattedDoc = await vscode.workspace.openTextDocument({
        content: outLines.join("\n"),
        language: "logviewer",
      });

      const editor = await vscode.window.showTextDocument(formattedDoc, {
        preview: false,
      });

      // 5) применяем подсветку логов
      applyDecorations(editor);
    })
  );
}

export function deactivate() { }
