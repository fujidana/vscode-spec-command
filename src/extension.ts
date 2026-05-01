// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { DictionaryController } from './dictionaryController';
import { FileController } from './fileController';

// this method is called when your extension is activated
export function activate(context: vscode.ExtensionContext): void {
    const dictionaryController = new DictionaryController(context);
    const fileController = new FileController(context);

    dictionaryController.fileUpdateSessionMap = fileController.updateSessionMap;
    fileController.dictionaryUpdateSessionMap = dictionaryController.updateSessionMap;
}

// this method is called when your extension is deactivated
export function deactivate(): void {
    return;
}
