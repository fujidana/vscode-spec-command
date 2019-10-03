import * as vscode from 'vscode';
import { TextDecoder } from 'util';
import * as estraverse from "estraverse";
import * as provider from "./specProvider";
import { SyntaxError, parse } from './grammar';

/**
 * check whether the document exists in the workspace and have been parsed
 */
function isDocumentInScannedWorkspace(document: vscode.TextDocument) {
    const scansWorkspace = vscode.workspace.getConfiguration('spec.parser').get('enableWorkspaceScan', false);

    return (scansWorkspace && document.uri.scheme === 'file' && vscode.workspace.asRelativePath(document.uri.path) !== document.uri.path);
}

/**
 * provider for opened documents
 */
export class SpecDocumentProvider extends provider.SpecProvider implements vscode.DocumentSymbolProvider, vscode.WorkspaceSymbolProvider {

    public diagnosticCollection: vscode.DiagnosticCollection;

    constructor() {
        super();

        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('spec');

        // asynchronously scan files and refresh the collection
        this.refreshCollections();

        // register a hander invoked when the document is changed
        vscode.workspace.onDidChangeTextDocument((documentChangeEvent) => {
            const document = documentChangeEvent.document;
            if (document.languageId === 'spec') {
                this.parseDocumentContents(document.getText(), document.uri);
            }
        });

        // register a hander invoked when the document is opened
        // this is also invoked after the user changed the language id
        vscode.workspace.onDidOpenTextDocument((document) => {
            if (document.languageId === 'spec' && !isDocumentInScannedWorkspace(document)) {
                this.parseDocumentContents(document.getText(), document.uri);
            }
        });

        // register a hander invoked when the document is saved
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (document.languageId === 'spec') {
                this.parseDocumentContents(document.getText(), document.uri);
            }
        });

        // register a hander invoked when the document is closed
        // this is also invoked after the user changed the language id
        vscode.workspace.onDidCloseTextDocument((document) => {
            if (document.languageId === 'spec' && !isDocumentInScannedWorkspace(document)) {
                const uriString = document.uri.toString();
                this.storageCollection.delete(uriString);
                this.diagnosticCollection.delete(document.uri);
                this.completionItemCollection.delete(uriString);
            }
        });

        // vscode.window.onDidChangeActiveTextEditor((editor) => {
        //     if (editor) {
        //         this.scanDocument(editor.document, 'active editor changed.');
        //     }
        // });

        // register a hander invoked when the configuration is changed
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('spec.parser.enableWorkspaceScan')) {
                this.refreshCollections();
            }
        });

        vscode.workspace.onDidChangeWorkspaceFolders((event) => {
            this.refreshCollections();
        });
    }

    private parseDocumentContents(contents: string, uri: vscode.Uri) {

        const uriString = uri.toString();
        const constantRefMap = new provider.ReferenceMap();
        const macroRefMap = new provider.ReferenceMap();
        const functionRefMap = new provider.ReferenceMap();
        const documentStorage = new provider.ReferenceStorage(
            [
                [provider.ReferenceItemKind.Constant, constantRefMap],
                [provider.ReferenceItemKind.Macro, macroRefMap],
                [provider.ReferenceItemKind.Function, functionRefMap],
            ]
        );

        let tree;
        try {
            tree = parse(contents);
        } catch (error) {
            const diagnostic = new vscode.Diagnostic(provider.convertRange(error.location), error.message, vscode.DiagnosticSeverity.Error);
            this.diagnosticCollection.set(uri, [diagnostic]);
            this.storageCollection.delete(uriString);
            // this.updateCompletionItemsForUriString(uriString);
            return false;
        }
        // console.log(JSON.stringify(tree, null, 2));

        const diagnostics = [];
        for (const item of tree.x_diagnostics) {
            const diagnostic = new vscode.Diagnostic(provider.convertRange(item.location), item.message, item.severity);
            diagnostics.push(diagnostic);
        }
        this.diagnosticCollection.set(uri, diagnostics);
        
        estraverse.traverse(tree, {
            enter: function(currentNode, parentNode) {
                // console.log('enter', currentNode.type, parentNode && parentNode.type);
                // only scan the top-level items
                if (parentNode && parentNode.type === 'Program') {
                    return estraverse.VisitorOption.Skip;
                }
            },
            leave: function(currentNode, parentNode) {
                // console.log('leave', currentNode.type, parentNode && parentNode.type);
                let refItem: provider.ReferenceItem | undefined;
                if (currentNode.type === 'FunctionDeclaration' && currentNode.id) {
                    if (currentNode.params) {
                        let signatureStr = currentNode.id.name + '(';
                        signatureStr += currentNode.params.map((param) => {
                            return (param.type === 'Identifier') ? param.name : '';
                        }).join(', ') + ')';
                        refItem = { signature: signatureStr, location: <any>currentNode.loc };
                        functionRefMap.set(currentNode.id.name, refItem);
                    } else {
                        refItem = { signature: currentNode.id.name, location: <any>currentNode.loc };
                        macroRefMap.set(currentNode.id.name, refItem);
                    }
                } else if (currentNode.type === 'VariableDeclaration' && currentNode.kind === 'const') {
                    for (const declarator of currentNode.declarations) {
                        if (declarator.type === "VariableDeclarator" && declarator.id.type === 'Identifier') {
                            let signatureStr = declarator.id.name;
                            if (declarator.init && declarator.init.type === 'Literal') {
                                signatureStr += ' = ' + declarator.init.raw;
                            }
                            refItem = { signature: signatureStr, location: <any>currentNode.loc };
                            constantRefMap.set(declarator.id.name, refItem);
                        }
                        break;
                    }
                }
                if (refItem && currentNode.leadingComments && currentNode.leadingComments.length > 0) {
                    refItem.description = currentNode.leadingComments[currentNode.leadingComments.length - 1].value;
                }
        },
            keys: {
                MacroStatement: ['arguments'],
                InvalidStatement: [],
                ExitStatement: [],
                NullExpression: [],
            }
        });

        this.storageCollection.set(uriString, documentStorage);
        this.updateCompletionItemsForUriString(uriString);
    }

    private async refreshCollections() {
        // clear the caches
        this.storageCollection.clear();
        this.diagnosticCollection.clear();
        this.completionItemCollection.clear();

        // parse opened documents
        const openedUriStringSet: Set<string> = new Set();
        for (const document of vscode.workspace.textDocuments) {
            if (document.languageId === 'spec') {
                this.parseDocumentContents(document.getText(), document.uri);
                openedUriStringSet.add(document.uri.toString());
            }
        }

        // if workspace scan is enabled, parse the other files in the workspace folders.
        const scansWorkspace = vscode.workspace.getConfiguration('spec.parser').get('enableWorkspaceScan', false);
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (scansWorkspace && workspaceFolders) {
            for (const workspaceFolder of workspaceFolders) {
                const pattern = new vscode.RelativePattern(workspaceFolder, '**/*.mac');
                const uris = (await vscode.workspace.findFiles(pattern)).filter((uri) => !openedUriStringSet.has(uri.toString()));
                for (const uri of uris) {
                    const contents = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
                    this.parseDocumentContents(contents, uri);
                }
            }
        }
    }

	/**
	 * required implementation of vscode.DocumentSymbolProvider
	 */
    provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.SymbolInformation[] | vscode.DocumentSymbol[]> {
        const refStorage = this.storageCollection.get(document.uri.toString());
        if (refStorage) {
            const symbols = [];
            for (const [refType, refMap] of refStorage.entries()) {
                const symbolKind = provider.convertReferenceItemKindToSymbolKind(refType);
                for (const [identifier, refItem] of refMap.entries()) {
                    if (refItem.location) {
                        const location = new vscode.Location(document.uri, provider.convertRange(refItem.location));
                        symbols.push(new vscode.SymbolInformation(identifier, symbolKind, '', location));
                    }
                }
            }
            if (symbols.length > 0) {
                return symbols;
            }
        }
    }

    /**
     * required implementation of vscode.WorkspaceSymbolProvider
     */
    provideWorkspaceSymbols(query: string, token: vscode.CancellationToken): vscode.ProviderResult<vscode.SymbolInformation[]> {
        // exit when the query is not empty and contains characters not allowed in an identifier.
        if (!/^[a-zA-Z0-9_]*$/.test(query)) {
            return undefined;
        }

        //  create a regular expression that filters symbols using the query
        // const regex = new RegExp(query.replace(/(?=[_A-Z])/g, '.*'), 'i');
        const regex = new RegExp(query.split('').join('.*'), 'i'); // e.g., 'abc' => /a.*b.*c/i

        const symbols = [];
        for (const [uriString, refStorage] of this.storageCollection.entries()) {
            for (const [refItemKind, refMap] of refStorage.entries()) {
                const symbolKind = provider.convertReferenceItemKindToSymbolKind(refItemKind);
                for (const [identifier, refItem] of refMap.entries()) {
                    if (query.length === 0 || regex.test(identifier)) {
                        if (refItem.location) {
                            const name = (refItemKind === provider.ReferenceItemKind.Function) ? identifier + '()' : identifier;
                            const location = new vscode.Location(vscode.Uri.parse(uriString), provider.convertRange(refItem.location));
                            symbols.push(new vscode.SymbolInformation(name, symbolKind, '', location));
                        }
                    }
                }
            }
        }
        if (symbols.length > 0) {
            return symbols;
        }
    }
}



