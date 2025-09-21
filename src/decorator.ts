import * as vscode from "vscode";
import { filterController } from "./filterController";

// Храним созданные декорации, чтобы не создавать новые каждый раз
const decorationsMap: { [lvl: string]: vscode.TextEditorDecorationType } = {};

function getLogLevelColors(): Record<string, string> {
  const config = vscode.workspace.getConfiguration("logviewer");
  return {
    T: config.get<string>("colorTrace") || "rgba(255,255,255,0.05)",
    D: config.get<string>("colorDebug") || "rgba(50,127,186,0.2)",
    I: config.get<string>("colorInfo") || "rgba(0,255,0,0.1)",
    W: config.get<string>("colorWarn") || "rgba(255,255,0,0.2)",//rgba(255,255,0,0.2) // "rgba(246,255,169,0.2)"
    E: config.get<string>("colorError") || "rgba(176,55,66,0.2)",
    C: config.get<string>("colorCritical") || "rgba(197,15,31,0.2)",
  };
}

function initDecorations() {
  const logLevelColors = getLogLevelColors();
  ["T", "D", "I", "W", "E", "C"].forEach(lvl => {
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

  Object.entries(decs).forEach(([lvl, ranges]) => {
    // очищаем старые декорации
    editor.setDecorations(decorationsMap[lvl], []);
  });


  const regLevel = /\[([TDIWEC])\]/;
  const filters = filterController.getCurrentFilters();

  for (let i = 0; i < editor.document.lineCount; i++) {
    const line = editor.document.lineAt(i).text;
    if (!passesFilters(line, filters)) continue;
    const m = regLevel.exec(line);
    if (m) decs[m[1]].push(new vscode.Range(i, 0, i, line.length));
  }

  Object.entries(decs).forEach(([lvl, ranges]) => {
    // применяем уже существующую декорацию
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
