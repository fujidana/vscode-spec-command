import * as vscode from 'vscode';
import * as provider from "./specProvider";
import { SyntaxError, parse } from './grammar';
import { TextDecoder } from 'util';

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
        const macroRefMap = new provider.ReferenceMap();
        const functionRefMap = new provider.ReferenceMap();
        const documentStorage = new provider.ReferenceStorage(
            [
                [provider.ReferenceItemKind.Macro, macroRefMap],
                [provider.ReferenceItemKind.Function, functionRefMap],
            ]
        );

        try {
            const ast = parse(contents);

            for (let i = 0; i < ast.body.length; i++) {
                const prevItem = (i > 0) ? ast.body[i - 1] : undefined;
                const currItem = ast.body[i];

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
                this.diagnosticCollection.delete(uri);
                this.storageCollection.set(uriString, documentStorage);
            }
        } catch (error) {
            const diagnostic = new vscode.Diagnostic(provider.convertRange(error.location), error.message, vscode.DiagnosticSeverity.Error);
            this.diagnosticCollection.set(uri, [diagnostic]);
            this.storageCollection.delete(uriString);
        }
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



