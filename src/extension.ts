// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { BuiltInController } from './builtInController';
import { FileController } from './fileController';

// this method is called when your extension is activated
export function activate(context: vscode.ExtensionContext): void {
    const builtInController = new BuiltInController(context);
    new FileController(context, builtInController);
}

// this method is called when your extension is deactivated
export function deactivate(): void {
    return;
}
