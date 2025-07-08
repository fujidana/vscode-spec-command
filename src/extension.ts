// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { BuiltinController } from './builtinController';
import { FileController } from './fileController';

// this method is called when your extension is activated
export function activate(context: vscode.ExtensionContext): void {
    const builtinController = new BuiltinController(context);
    new FileController(context, builtinController);
}

// this method is called when your extension is deactivated
export function deactivate(): void {
    return;
}
