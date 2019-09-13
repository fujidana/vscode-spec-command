import * as vscode from 'vscode';
import * as provider from "./specProvider";
import { SyntaxError, parse } from './grammar';

export class SpecDocumentProvider extends provider.SpecProvider {

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
    }

    private unregisterStoragesForDocumentUri(uri: vscode.Uri) {
        this.registeredStorages.delete(uri);
        this.diagnosticCollection.delete(uri);
    }

    protected scanDocument(document: vscode.TextDocument, createStorages: boolean) {
        if (document.languageId === 'spec') {

            const macroRefMap = new provider.ReferenceMap();
            const functionRefMap = new provider.ReferenceMap();

            const documentStorage = new provider.ReferenceStorage(
                [
                    [provider.ReferenceItemKind.Macro, macroRefMap],
                    [provider.ReferenceItemKind.Function, functionRefMap]
                ]
            );
            this.registeredStorages.set(document.uri, documentStorage);

            try {
                const simpleAST = parse(document.getText());

                if (Array.isArray(simpleAST.body)) {
                    for (let i = 0; i < simpleAST.body.length; i++) {
                        const prevItem = (i > 0) ? simpleAST.body[i - 1] : undefined;
                        const currItem = simpleAST.body[i];
                        if ('type' in currItem && currItem.type === 'FunctionDeclaration') {
                            let refItem: provider.ReferenceItem;
                            if (currItem.params) {
                                refItem = { signature: `${currItem.id.name}(${currItem.params.join(', ')})`, location: currItem.location };
                                functionRefMap.set(currItem.id.name, refItem);
                            } else {
                                refItem = { signature: currItem.id.name, location: currItem.location };
                                macroRefMap.set(currItem.id.name, refItem);
                            }
                            if (i > 0 && prevItem.hasOwnProperty('type') && prevItem.type === 'EmptyStatement' && prevItem.hasOwnProperty('docstring')) {
                                refItem.description = prevItem.docstring;
                            }
                        }
                    }
                }
                this.diagnosticCollection.delete(document.uri);
            } catch (error) {
                const diagnostic = new vscode.Diagnostic(provider.convertRange(error.location), error.message, vscode.DiagnosticSeverity.Error);
                this.diagnosticCollection.set(document.uri, [diagnostic]);
            }

            this.completionItems = [];
            this.updateCompletionItems();
        }
    }
}
