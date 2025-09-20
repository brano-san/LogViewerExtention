import * as vscode from 'vscode';

export function getColorForLevel(level: string): string {
  const config = vscode.workspace.getConfiguration('logviewer.color');
  return config.get<string>(level, '#FFFFFF');
}
