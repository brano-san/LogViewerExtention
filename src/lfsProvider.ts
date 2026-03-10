import * as vscode from 'vscode';
import * as fs from 'fs';

export class LFSProvider implements vscode.FileSystemProvider {
    limitedSize: number = 1024 * 1024; // На первый запрос отдаем только 1 МБ
    reReadTimeout: number = 2000;      // Через 2 секунды отдадим весь файл

    private _uriMap: Map<string, { limitSize: boolean, fileBuffer?: Buffer }> = new Map();
    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

    stat(uri: vscode.Uri): vscode.FileStat {
        if (!this._uriMap.has(uri.toString())) {
            this._uriMap.set(uri.toString(), { limitSize: true });
        }
        const limitSize = this._uriMap.get(uri.toString())?.limitSize;
        const fileUri = uri.with({ scheme: 'file' });
        const realStat = fs.statSync(fileUri.fsPath);

        // Если включен лимит и файл реально больше 1мб — врем VS Code, что он весит 1мб
        return {
            ctime: realStat.ctime.valueOf(),
            mtime: realStat.mtime.valueOf(),
            size: (limitSize && realStat.size > this.limitedSize) ? this.limitedSize : realStat.size,
            type: realStat.isFile() ? vscode.FileType.File : vscode.FileType.Unknown
        };
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        if (!this._uriMap.has(uri.toString())) {
            this._uriMap.set(uri.toString(), { limitSize: true });
        }
        let curSet = this._uriMap.get(uri.toString());
        if (!curSet) throw vscode.FileSystemError.Unavailable();

        if (!curSet.fileBuffer) {
            const fileUri = uri.with({ scheme: 'file' });
            curSet.fileBuffer = fs.readFileSync(fileUri.fsPath);
        }

        if (curSet.limitSize && curSet.fileBuffer && curSet.fileBuffer.length <= this.limitedSize) {
            curSet.limitSize = false;
        }

        if (curSet.limitSize) {
            // Запускаем таймер. Через 2 секунды скажем редактору "перечитай меня"
            setTimeout(() => {
                let current = this._uriMap.get(uri.toString());
                if (current) {
                    current.limitSize = false;
                    this._uriMap.set(uri.toString(), current);
                }
                this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri: uri }]);
            }, this.reReadTimeout);

            // Отдаем фейковый обрезанный кусок для прохождения проверки
            return curSet.fileBuffer.slice(0, this.limitedSize);
        } else {
            // Отдаем полный файл
            let toRet = curSet.fileBuffer;
            curSet.fileBuffer = undefined; // Очищаем память
            return toRet;
        }
    }

    watch(uri: vscode.Uri): vscode.Disposable {
        return new vscode.Disposable(() => {
            let curSet = this._uriMap.get(uri.toString());
            if (curSet) {
                curSet.fileBuffer = undefined;
                this._uriMap.set(uri.toString(), curSet);
            }
        });
    }

    onDidCloseTextDocument(uri: vscode.Uri) {
        let curSet = this._uriMap.get(uri.toString());
        if (curSet) {
            curSet.limitSize = true;
            curSet.fileBuffer = undefined;
            this._uriMap.set(uri.toString(), curSet);
        }
    }

    // Заглушки для обязательных методов FileSystemProvider (мы только читаем)
    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] { return []; }
    writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): void { throw vscode.FileSystemError.NoPermissions(); }
    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void { throw vscode.FileSystemError.NoPermissions(); }
    delete(uri: vscode.Uri): void { throw vscode.FileSystemError.NoPermissions(); }
    createDirectory(uri: vscode.Uri): void { throw vscode.FileSystemError.NoPermissions(); }
}