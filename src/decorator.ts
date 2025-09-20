import * as vscode from "vscode";
import { filterController } from "./filterController";

function getLogLevelColors(): Record<string, string> {
  const config = vscode.workspace.getConfiguration("logviewer");
  return {
    T: config.get<string>("colorTrace") || "rgba(255,255,255,0.05)",
    D: config.get<string>("colorDebug") || "rgba(50, 127, 186, 1)",
    I: config.get<string>("colorInfo") || "rgba(0,255,0,0.1)",
    W: config.get<string>("colorWarn") || "rgba(246, 255, 169, 0.6)",
    E: config.get<string>("colorError") || "rgba(176, 55, 66, 1)",
    C: config.get<string>("colorCritical") || "rgba(197, 15, 31, 1)",
  };
}

export function applyDecorations(editor: vscode.TextEditor) {
  const logLevelColors = getLogLevelColors();
  const regLevel = /\[([TDIWEC])\]/;
  const filters = filterController.getCurrentFilters();

  const decorationsMap: { [lvl: string]: vscode.TextEditorDecorationType } = {};
  ["T", "D", "I", "W", "E", "C"].forEach(
    (lvl) =>
    (decorationsMap[lvl] = vscode.window.createTextEditorDecorationType({
      backgroundColor: logLevelColors[lvl],
      isWholeLine: true,
    }))
  );

  const decs: { [lvl: string]: vscode.Range[] } = {};
  ["T", "D", "I", "W", "E", "C"].forEach((lvl) => (decs[lvl] = []));

  for (let i = 0; i < editor.document.lineCount; i++) {
    const line = editor.document.lineAt(i).text;
    if (!passesFilters(line, filters)) continue;
    const m = regLevel.exec(line);
    if (m) decs[m[1]].push(new vscode.Range(i, 0, i, line.length));
  }

  Object.entries(decs).forEach(([lvl, ranges]) =>
    editor.setDecorations(decorationsMap[lvl], ranges)
  );
}

function passesFilters(
  line: string,
  filters: { include?: string; exclude?: string }
) {
  if (filters.include && !new RegExp(filters.include, "i").test(line)) return false;
  if (filters.exclude && new RegExp(filters.exclude, "i").test(line)) return false;
  return true;
}
