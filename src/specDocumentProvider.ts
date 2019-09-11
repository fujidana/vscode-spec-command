import * as vscode from 'vscode';
import { SpecProvider, SymbolStorage, SymbolInformation, SymbolAffiliation, convertRange } from "./specProvider";
import { SyntaxError, parse } from './grammar';

export class SpecDocumentProvider extends SpecProvider {

    diagnosticCollection: vscode.DiagnosticCollection;

    constructor() {
        super();

        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('spec');

        // scan the documents when the provider is initialized
        for (const document of vscode.workspace.textDocuments) {
            this.scanDocument(document, true);
        }

        // register a hander invoked when the document is changed
        vscode.workspace.onDidChangeTextDocument((documentChangeEvent) => {
            this.scanDocument(documentChangeEvent.document, false);
        });

        // register a hander invoked when the document is opened
        vscode.workspace.onDidOpenTextDocument((document) => {
            this.scanDocument(document, true);
        });

        // register a hander invoked when the document is saved
        vscode.workspace.onDidSaveTextDocument((document) => {
            this.scanDocument(document, false);
        });

        // register a hander invoked when the document is closed
        vscode.workspace.onDidCloseTextDocument((document) => {
            this.unregisterStoragesForDocumentUri(document.uri);
        });

        // vscode.window.onDidChangeActiveTextEditor((editor) => {
        //     if (editor) {
        //         this.scanDocument(editor.document, 'active editor changed.');
        //     }
        // });

        // if (vscode.workspace.workspaceFolders) {
        //     vscode.workspace.workspaceFolders.forEach((workspaceFolder) =>{
        //         const pattern = new vscode.RelativePattern(workspaceFolder, '**/*.mac');
        //         vscode.workspace.findFiles(pattern).then(urls => {
        //             // console.log(urls);
        //         });
        //     });
        // }
        // console.log(vscode.workspace);

        // vscode.workspace.onDidChangeWorkspaceFolders((e) => {
        // 	console.log('onDidChangeWorkspaceFolders', e);
        // });
    }

    private registerStoragesForDocumentUri(uri: vscode.Uri) {
        const functionStorage = new SymbolStorage([], SymbolAffiliation.Document, vscode.CompletionItemKind.Method, uri);
        const macroStorage = new SymbolStorage([], SymbolAffiliation.Document, vscode.CompletionItemKind.Function, uri);
        this.symbolStorages.push(functionStorage, macroStorage);
        return [functionStorage, macroStorage];
    }

    private findStoragesForDocumentUri(uri: vscode.Uri) {
        const storages = this.symbolStorages.filter((storage) => storage.uri === uri);
        const macroStorages = storages.filter((storage) => storage.itemKind === vscode.CompletionItemKind.Function);
        const functionStorages = storages.filter((storage) => storage.itemKind === vscode.CompletionItemKind.Method);
        return [functionStorages[0], macroStorages[0]];
    }

    private unregisterStoragesForDocumentUri(uri: vscode.Uri) {
        this.symbolStorages = this.symbolStorages.filter((storage) => storage.uri !== uri);
        this.diagnosticCollection.delete(uri);
    }

    public scanDocument(document: vscode.TextDocument, createStorages: boolean) {
        if (document.languageId === 'spec') {
            let storages;
            if (createStorages) {
                storages = this.registerStoragesForDocumentUri(document.uri);
            } else {
                storages = this.findStoragesForDocumentUri(document.uri);
            }
            const functionStorage = storages[0];
            const macroStorage = storages[1];
            
            try {
                const simpleAST = parse(document.getText());

                if (Array.isArray(simpleAST.body)) {
                    for (let i = 0; i < simpleAST.body.length; i++) {
                        const prevItem = (i > 0) ? simpleAST.body[i - 1] : undefined;
                        const currItem = simpleAST.body[i];
                        if ('type' in currItem && currItem.type === 'FunctionDeclaration') {
                            let refItem: SymbolInformation;
                            if (currItem.params) {
                                refItem = { signature: `${currItem.id.name}(${currItem.params.join(', ')})`, location: currItem.location };
                                functionStorage.set(currItem.id.name, refItem);
                            } else {
                                refItem = { signature: currItem.id.name, location: currItem.location };
                                macroStorage.set(currItem.id.name, refItem);
                            }
                            if (i > 0 && prevItem.hasOwnProperty('type') && prevItem.type === 'EmptyStatement' && prevItem.hasOwnProperty('docstring')) {
                                refItem.description = prevItem.docstring;
                            }
                        }
                    }
                }
                this.diagnosticCollection.delete(document.uri);
            } catch (error) {
                const diagnostic = new vscode.Diagnostic(convertRange(error.location), error.message, vscode.DiagnosticSeverity.Error);
                this.diagnosticCollection.set(document.uri, [diagnostic]);
            }

            this.completionItems = [];
            this.updateCompletionItems();
        }
    }
}
