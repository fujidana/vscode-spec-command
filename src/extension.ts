// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import {SystemProvider} from './systemProvider';
import {UserProvider} from './userProvider';

// this method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
	const systemProvider = new SystemProvider(context.asAbsolutePath('./syntaxes/spec.apiReference.json'));
	const userProvider = new UserProvider();
	const selector = { scheme: '*', language: 'spec' };
	
	context.subscriptions.push(
		// built-in provider
		vscode.languages.registerCompletionItemProvider(selector, systemProvider),
		vscode.languages.registerSignatureHelpProvider(selector, systemProvider, '(', ')', ','),
		vscode.languages.registerHoverProvider(selector, systemProvider),
		vscode.workspace.registerTextDocumentContentProvider('spec', systemProvider),
		// document provider
		userProvider.diagnosticCollection,
		vscode.languages.registerCompletionItemProvider(selector, userProvider),
		vscode.languages.registerSignatureHelpProvider(selector, userProvider, '(', ')', ','),
		vscode.languages.registerHoverProvider(selector, userProvider),
		vscode.languages.registerDefinitionProvider(selector, userProvider),
		vscode.languages.registerDocumentSymbolProvider(selector, userProvider),
		vscode.languages.registerWorkspaceSymbolProvider(userProvider),
	);
}

// this method is called when your extension is deactivated
export function deactivate() { }
