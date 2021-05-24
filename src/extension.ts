// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { SystemMacroProvider } from './systemProvider';
import { UserMacroProvider } from './userMacroProvider';

// this method is called when your extension is activated
export function activate(context: vscode.ExtensionContext): void {
    new SystemMacroProvider(context);
    new UserMacroProvider(context);
}

// this method is called when your extension is deactivated
// export function deactivate(): undefined {
//     return undefined;
// }
