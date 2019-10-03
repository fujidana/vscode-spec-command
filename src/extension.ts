// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import {SpecBuiltinProvider} from './specBuiltinProvider';
import {SpecDocumentProvider} from './specDocumentProvider';

// this method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
	const builtinProvider = new SpecBuiltinProvider(context.asAbsolutePath('./syntaxes/spec.apiReference.json'));
	const documentProvider = new SpecDocumentProvider();
	const selector = { scheme: '*', language: 'spec' };
	
	context.subscriptions.push(
		// built-in provider
		vscode.languages.registerCompletionItemProvider(selector, builtinProvider),
		vscode.languages.registerSignatureHelpProvider(selector, builtinProvider, '(', ')', ','),
		vscode.languages.registerHoverProvider(selector, builtinProvider),
		vscode.workspace.registerTextDocumentContentProvider('spec', builtinProvider),
		// document provider
		documentProvider.diagnosticCollection,
		vscode.languages.registerCompletionItemProvider(selector, documentProvider),
		vscode.languages.registerSignatureHelpProvider(selector, documentProvider, '(', ')', ','),
		vscode.languages.registerHoverProvider(selector, documentProvider),
		vscode.languages.registerDefinitionProvider(selector, documentProvider),
		vscode.languages.registerDocumentSymbolProvider(selector, documentProvider),
		vscode.languages.registerWorkspaceSymbolProvider(documentProvider),
	);
}

// this method is called when your extension is deactivated
export function deactivate() { }
