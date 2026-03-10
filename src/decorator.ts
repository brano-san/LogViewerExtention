import * as vscode from "vscode";
import { filterController } from "./filterController";

export const decorationsMap: { [lvl: string]: vscode.TextEditorDecorationType } = {};

function getLogLevelColors(): Record<string, string> {
  const config = vscode.workspace.getConfiguration("logviewer");
  return {
    T: config.get<string>("colorTrace") || "rgba(255,255,255,0.05)",
    D: config.get<string>("colorDebug") || "rgba(25, 70, 120, 1)",
    I: config.get<string>("colorInfo") || "rgba(0,255,0,0.1)",
    W: config.get<string>("colorWarn") || "rgba(246, 255, 169, 0.5)",
    E: config.get<string>("colorError") || "rgba(176,55,66,0.8)",
    C: config.get<string>("colorCritical") || "rgba(197,15,31,0.8)",
  };
}

function initDecorations() {
  const logLevelColors = getLogLevelColors();["T", "D", "I", "W", "E", "C"].forEach(lvl => {
    if (!decorationsMap[lvl]) {
      decorationsMap[lvl] = vscode.window.createTextEditorDecorationType({
        backgroundColor: logLevelColors[lvl],
        isWholeLine: true,
      });
    }
  });
}

export function applyDecorations(editor: vscode.TextEditor) {
  if (Object.keys(decorationsMap).length === 0) initDecorations();

  const decs: { [lvl: string]: vscode.Range[] } = {};
  ["T", "D", "I", "W", "E", "C"].forEach(lvl => decs[lvl] = []);

  const regLevel = /\[([TDIWEC])\]/;
  const filters = filterController.getCurrentFilters();

  // РАСКРАШИВАЕМ ВЕСЬ ФАЙЛ ЦЕЛИКОМ (Без visibleRanges)
  for (let i = 0; i < editor.document.lineCount; i++) {
    const line = editor.document.lineAt(i).text;
    if (!passesFilters(line, filters)) continue;
    
    const m = regLevel.exec(line);
    if (m) {
      decs[m[1]].push(new vscode.Range(i, 0, i, line.length));
    }
  }

  // Применяем новые декорации (VS Code автоматически очистит старые)
  Object.entries(decs).forEach(([lvl, ranges]) => {
    editor.setDecorations(decorationsMap[lvl], ranges);
  });
}

function passesFilters(
  line: string,
  filters: { include?: string; exclude?: string }
) {
  if (filters.include && !new RegExp(filters.include, "i").test(line)) return false;
  if (filters.exclude && new RegExp(filters.exclude, "i").test(line)) return false;
  return true;
}