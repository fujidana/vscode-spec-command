import * as vscode from 'vscode';
import { TextDecoder } from 'util';
import * as estree from "estree";
import * as estraverse from "estraverse";
import * as spec from "./spec";
import { Provider } from "./provider";
import { SyntaxError, parse, IFileRange } from './grammar';

/**
 * Extention-specific keys for estraverse (not exist in the original Parser AST.)
 */
const ADDITIONAL_TRAVERSE_KEYS = {
    MacroStatement: ['arguments'],
    InvalidStatement: [],
    ExitStatement: [],
    NullExpression: [],
};

/**
 * @param tree Parser AST object
 * @param position the current cursor position. If not given, top-level symbols (global variables, constant, macro and functions) are picked up.
 */
function collectSymbolsFromTree(tree: estree.Program, position?: vscode.Position): spec.ReferenceStorage {

    const constantRefMap = new spec.ReferenceMap();
    const variableRefMap = new spec.ReferenceMap();
    const macroRefMap = new spec.ReferenceMap();
    const functionRefMap = new spec.ReferenceMap();

    // console.log('<<<Scan start>>>', JSON.stringify(position, undefined, ""));

    estraverse.traverse(tree, {
        enter: (currentNode, parentNode) => {
            // console.log('enter', currentNode.type, parentNode && parentNode.type);

            // This traverser only traverses statements.
            if (parentNode === null && currentNode.type === 'Program') {
                // if it is a top-level, dig in.
                return;
            } else if (!currentNode.type.endsWith('Statement') && !currentNode.type.endsWith('Declaration')) {
                // if not any type of statements, skip.
                return estraverse.VisitorOption.Skip;
            }

            const nodeRange = currentNode.loc ? spec.convertRange(<IFileRange>currentNode.loc) : undefined;
            let refItem: spec.ReferenceItem | undefined;

            if (!nodeRange) {
                console.log('Statement should have location. This may be a bug in the parser.');
                return;
            }

            if (position) {
                // in case of active document

                if (currentNode.type === 'BlockStatement' && nodeRange.end.isBefore(position)) {
                    // skip the code block that ends before the cursor.
                    return estraverse.VisitorOption.Skip;

                } else if (currentNode.type === 'FunctionDeclaration' && currentNode.params && nodeRange.contains(position)) {
                    // register arguments of function as variables if the cursor is in the function block.
                    for (const param of currentNode.params) {
                        if (param.type === 'Identifier') {
                            refItem = { signature: param.name, location: <any>currentNode.loc };
                            variableRefMap.set(param.name, refItem);
                        }
                    }
                } else if (nodeRange.start.isAfter(position)) {
                    return estraverse.VisitorOption.Break;
                }
            }

            if (currentNode.type === 'FunctionDeclaration' && currentNode.id) {
                if (currentNode.params) {
                    // register the id as a function if parameter is not null.
                    if (!position || (parentNode && parentNode.type !== 'Program')) {
                        let signatureStr = currentNode.id.name + '(';
                        signatureStr += currentNode.params.map(param => (param.type === 'Identifier') ? param.name : '').join(', ') + ')';
                        refItem = { signature: signatureStr, location: <IFileRange>currentNode.loc };
                        functionRefMap.set(currentNode.id.name, refItem);
                    }

                } else {
                    // register the id as a traditional macro if parameter is null.
                    if (!position || (parentNode && parentNode.type !== 'Program')) {
                        refItem = { signature: currentNode.id.name, location: <IFileRange>currentNode.loc };
                        macroRefMap.set(currentNode.id.name, refItem);
                    }
                }

            } else if (currentNode.type === 'VariableDeclaration') {
                if (!position || (parentNode && parentNode.type !== 'Program')) {
                    for (const declarator of currentNode.declarations) {
                        if (declarator.type === "VariableDeclarator" && declarator.id.type === 'Identifier') {
                            let signatureStr = declarator.id.name;
                            if (declarator.init && declarator.init.type === 'Literal') {
                                signatureStr += ' = ' + declarator.init.raw;
                            }
                            refItem = { signature: signatureStr, location: <IFileRange>currentNode.loc };
                            if (currentNode.kind === 'const') {
                                constantRefMap.set(declarator.id.name, refItem);
                            } else {
                                variableRefMap.set(declarator.id.name, refItem);
                            }
                        }
                    }
                }
            }

            // add docstrings            
            if (refItem && currentNode.leadingComments && currentNode.leadingComments.length > 0) {
                refItem.description = currentNode.leadingComments[currentNode.leadingComments.length - 1].value;
            }

            if (!position) {
                // in case of inactive document
                // only scan the top-level items
                if (parentNode && parentNode.type === 'Program') {
                    return estraverse.VisitorOption.Skip;
                }
            }
        },
        leave: (currentNode, parentNode) => {
            // console.log('leave', currentNode.type, parentNode && parentNode.type);
        },
        keys: ADDITIONAL_TRAVERSE_KEYS,
    });

    return new spec.ReferenceStorage(
        [
            [spec.ReferenceItemKind.Constant, constantRefMap],
            [spec.ReferenceItemKind.Variable, variableRefMap],
            [spec.ReferenceItemKind.Macro, macroRefMap],
            [spec.ReferenceItemKind.Function, functionRefMap],
        ]
    );
}

async function findFilesInWorkspaces() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const map = new Map<string, { diagnoseProblems: boolean }>();

    if (workspaceFolders) {
        for (const workspaceFolder of workspaceFolders) {
            const config = vscode.workspace.getConfiguration('vscode-spec.workspace', workspaceFolder.uri);
            const inclusivePatternStr = config.get<string>('inclusiveFilePattern', '**/*.mac');
            const exclusivePatternStr = config.get<string>('exclusiveFilePattern', '');
            const diagnoseProblems = config.get<boolean>('diagnoseProblems', false);
            const inclusivePattern = new vscode.RelativePattern(workspaceFolder, inclusivePatternStr);
            const exclusivePattern = (exclusivePatternStr.length > 0) ? new vscode.RelativePattern(workspaceFolder, exclusivePatternStr) : undefined;
            const uris = await vscode.workspace.findFiles(inclusivePattern, exclusivePattern);
            for (const uri of uris) {
                map.set(uri.toString(), { diagnoseProblems });
            }
        }
    }
    return map;
}

/**
 * Provider class for user documents.
 * This class manages opened documents and other documents in the current workspace.
 */
export class UserProvider extends Provider implements vscode.DefinitionProvider, vscode.DocumentSymbolProvider, vscode.WorkspaceSymbolProvider {

    private readonly diagnosticCollection: vscode.DiagnosticCollection;
    private readonly treeCollection: Map<string, estree.Program>;

    constructor(context: vscode.ExtensionContext) {
        super(context);

        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('vscode-spec');
        this.treeCollection = new Map();

        // command to run selection in terminal
        const execSelectionInTerminalCommandCallback = () => {
            const terminal = vscode.window.activeTerminal;
            if (!terminal) {
                vscode.window.showErrorMessage('Terminal is not opened.');
                return;
            }
            vscode.commands.executeCommand('workbench.action.terminal.runSelectedText');
        };

        // command to run file in terminal
        const execFileInTerminalCommandCallback = (...args: any[]) => {
            const terminal = vscode.window.activeTerminal;
            if (!terminal) {
                vscode.window.showErrorMessage('Active terminal is not found.');
                return;
            }

            let uri: vscode.Uri;
            if (args && args.length > 0 && args[0] instanceof vscode.Uri) {
                uri = args[0];
            } else {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showErrorMessage('Active editor is not found.');
                    return;
                }
                uri = editor.document.uri;
            }

            const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
            let path: string;
            if (workspaceFolder) {
                const config = vscode.workspace.getConfiguration('vscode-spec.command', workspaceFolder.uri);
                const prefix = config.get<string>('filePathPrefixInTerminal', '');
                path = prefix + vscode.workspace.asRelativePath(uri, false);
            } else {
                path = uri.path;
            }
            terminal.show(true);
            terminal.sendText(`qdofile(\"${path}\")`);
        };

        // a hander invoked when the document is changed
        const onDidChangeTextDocumentListener = (event: vscode.TextDocumentChangeEvent) => {
            const document = event.document;
            if (document.languageId === 'spec') {
                this.parseDocumentContents(document.getText(), document.uri, true, true);
            }
        };

        // a hander invoked when the document is opened
        // this is also invoked after the user manually changed the language id
        const onDidOpenTextDocumentListener = (document: vscode.TextDocument) => {
            if (document.languageId === 'spec') {
                this.parseDocumentContents(document.getText(), document.uri, true, true);
            }
        };

        // a hander invoked when the document is saved
        const onDidSaveTextDocumentListener = (document: vscode.TextDocument) => {
            if (document.languageId === 'spec') {
                this.parseDocumentContents(document.getText(), document.uri, true, true);
            }
        };

        // register a hander invoked when the document is closed
        // this is also invoked after the user manually changed the language id
        const onDidCloseTextDocumentListener = async (document: vscode.TextDocument) => {
            if (document.languageId === 'spec') {
                const uriString = document.uri.toString();

                this.treeCollection.delete(uriString);

                // check whether the file is in a workspace folder. If not in a folder, delete from the database.
                const filesInWorkspaces = await findFilesInWorkspaces();
                const fileInfo = filesInWorkspaces.get(uriString);
                if (fileInfo) {
                    // if file also exists in a workspace folder,
                    // clear diagnostics if setting for workspace.diagnoseProblem is false. 
                    if (!fileInfo.diagnoseProblems) {
                        this.diagnosticCollection.delete(document.uri);
                    }
                } else {
                    // if file does not exist in a workspace folder, clear all
                    this.storageCollection.delete(uriString);
                    this.diagnosticCollection.delete(document.uri);
                    this.completionItemCollection.delete(uriString);
                }
            }
        };

        // const onDidChangeActiveTextEditorListener = (editor: vscode.TextEditor | undefined) => {
        //     if (editor) {
        //         const document = editor.document;
        //         this.parseDocumentContents(document.getText(), document.uri, true, true);
        //     }
        // };

        // a hander invoked when the configuration is changed
        const onDidChangeConfigurationListener = (event: vscode.ConfigurationChangeEvent) => {
            if (event.affectsConfiguration('vscode-spec.workspace')) {
                this.refreshCollections();
            }
        };

        const onDidChangeWorkspaceFoldersListener = (event: vscode.WorkspaceFoldersChangeEvent) => {
            this.refreshCollections();
        };

        context.subscriptions.push(
            // register command handlers
            vscode.commands.registerCommand('vscode-spec.execSelectionInTerminal', execSelectionInTerminalCommandCallback),
            vscode.commands.registerCommand('vscode-spec.execFileInTerminal', execFileInTerminalCommandCallback),
            // register event liasteners
            vscode.workspace.onDidChangeTextDocument(onDidChangeTextDocumentListener),
            vscode.workspace.onDidOpenTextDocument(onDidOpenTextDocumentListener),
            vscode.workspace.onDidSaveTextDocument(onDidSaveTextDocumentListener),
            vscode.workspace.onDidCloseTextDocument(onDidCloseTextDocumentListener),
            // vscode.window.onDidChangeActiveTextEditor(onDidChangeActiveTextEditorListener),
            vscode.workspace.onDidChangeConfiguration(onDidChangeConfigurationListener),
            vscode.workspace.onDidChangeWorkspaceFolders(onDidChangeWorkspaceFoldersListener),
            // register providers
            vscode.languages.registerDefinitionProvider(spec.SELECTOR, this),
            vscode.languages.registerDocumentSymbolProvider(spec.SELECTOR, this),
            vscode.languages.registerWorkspaceSymbolProvider(this),
            // register diagnostic collection
            this.diagnosticCollection,
        );

        // asynchronously scan files and refresh the collection
        this.refreshCollections();
    }

    private parseDocumentContents(contents: string, uri: vscode.Uri, isOpenDocument: boolean, diagnoseProblems: boolean) {
        const uriString = uri.toString();

        interface CustomProgram extends estree.Program {
            x_diagnostics: any[];
        }

        let tree: CustomProgram | undefined;
        try {
            tree = <CustomProgram>parse(contents);
        } catch (error) {
            if (error instanceof SyntaxError) {
                if (diagnoseProblems) {
                    const diagnostic = new vscode.Diagnostic(spec.convertRange(error.location), error.message, vscode.DiagnosticSeverity.Error);
                    this.diagnosticCollection.set(uri, [diagnostic]);
                    // this.updateCompletionItemsForUriString(uriString);
                }
            } else {
                console.log('Unknown Error in sytax parsing', error);
            }
            this.storageCollection.delete(uriString);
            return false;
        }
        // console.log(JSON.stringify(tree, null, 2));

        if (diagnoseProblems) {
            const diagnostics = tree.x_diagnostics.map((item: any) => new vscode.Diagnostic(spec.convertRange(item.location), item.message, item.severity));
            this.diagnosticCollection.set(uri, diagnostics);
        }

        if (isOpenDocument) {
            this.treeCollection.set(uriString, tree);
        }

        this.storageCollection.set(uriString, collectSymbolsFromTree(tree));
        this.updateCompletionItemsForUriString(uriString);
        return true;
    }

    /**
     * scan open files and other files in workspace folders.
     * invoked manually when needed.
     */
    private async refreshCollections() {
        // clear the caches
        this.storageCollection.clear();
        this.diagnosticCollection.clear();
        this.completionItemCollection.clear();

        // parse documents opened by editors
        const openedUriStringSet = new Set<string>();
        for (const document of vscode.workspace.textDocuments) {
            if (document.languageId === 'spec') {
                this.parseDocumentContents(document.getText(), document.uri, true, true);
                openedUriStringSet.add(document.uri.toString());
            }
        }

        // parse the other files in workspace folders.
        const filesInWorkspaces = await findFilesInWorkspaces();

        for (const [uriString, fileInfo] of filesInWorkspaces) {
            if (!openedUriStringSet.has(uriString)) {
                const uri = vscode.Uri.parse(uriString);
                const contents = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
                this.parseDocumentContents(contents, uri, false, fileInfo.diagnoseProblems);
            }
        }
    }

    /**
	 * Required implementation of vscode.CompletionItemProvider, overriding the super class
     */
    public provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.CompletionItem[] | undefined {
        if (token.isCancellationRequested) { return; }

        const tree = this.treeCollection.get(document.uri.toString());
        if (tree) {
            this.storageCollection.set(spec.ACTIVE_FILE_URI, collectSymbolsFromTree(tree, position));
            this.updateCompletionItemsForUriString(spec.ACTIVE_FILE_URI);
        }
        return super.provideCompletionItems(document, position, token, context);
    }

	/**
	 * Required implementation of vscode.HoverProvider, overriding the super class
	 */
    public provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.Hover | undefined {
        if (token.isCancellationRequested) { return; }

        const tree = this.treeCollection.get(document.uri.toString());
        if (tree) {
            this.storageCollection.set(spec.ACTIVE_FILE_URI, collectSymbolsFromTree(tree, position));
        }
        return super.provideHover(document, position, token);
    }

	/**
	 * Required implementation of vscode.DefinitionProvider
	 */
    public provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Definition | vscode.DefinitionLink[]> {
        if (token.isCancellationRequested) { return; }

        const range = document.getWordRangeAtPosition(position);
        if (range === undefined) { return; }

        const selectorName = document.getText(range);
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(selectorName)) { return; }

        // update the storage for local variables for the current cursor position.
        const tree = this.treeCollection.get(document.uri.toString());
        if (tree) {
            this.storageCollection.set(spec.ACTIVE_FILE_URI, collectSymbolsFromTree(tree, position));
        }

        // seek the identifier
        const locations: vscode.Location[] = [];
        for (const [uriString, storage] of this.storageCollection.entries()) {
            const uri = (uriString === spec.ACTIVE_FILE_URI) ? document.uri : vscode.Uri.parse(uriString);

            // seek through storages for all types of symbols
            for (const map of storage.values()) {
                const item = map.get(selectorName);
                if (item && item.location) {
                    locations.push(new vscode.Location(uri, spec.convertRange(item.location)));
                }
            }
        }
        return locations;
    }

    /**
	 * Required implementation of vscode.DocumentSymbolProvider
	 */
    public provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.SymbolInformation[] | vscode.DocumentSymbol[]> {
        if (token.isCancellationRequested) { return; }

        const storage = this.storageCollection.get(document.uri.toString());
        if (!storage) { return; }

        // seek the identifier
        const symbols: vscode.SymbolInformation[] = [];
        for (const [itemKind, map] of storage.entries()) {
            const symbolKind = spec.getSymbolKindFromReferenceItemKind(itemKind);
            for (const [identifier, item] of map.entries()) {
                if (item.location) {
                    const location = new vscode.Location(document.uri, spec.convertRange(item.location));
                    symbols.push(new vscode.SymbolInformation(identifier, symbolKind, '', location));
                }
            }
        }
        return symbols;
    }

    /**
     * Required implementation of vscode.WorkspaceSymbolProvider
     */
    public provideWorkspaceSymbols(query: string, token: vscode.CancellationToken): vscode.ProviderResult<vscode.SymbolInformation[]> {
        if (token.isCancellationRequested) { return; }

        // exit when the query is not empty and contains characters not allowed in an identifier.
        if (!/^[a-zA-Z0-9_]*$/.test(query)) { return; }

        // create a regular expression that filters symbols using the query
        // const regExp = new RegExp(query.replace(/(?=[_A-Z])/g, '.*'), 'i');
        const regExp = new RegExp(query.split('').join('.*'), 'i'); // e.g., 'abc' => /a.*b.*c/i

        // seek the identifier
        const symbols: vscode.SymbolInformation[] = [];
        for (const [uriString, storage] of this.storageCollection.entries()) {
            // skip storage for local variables
            if (uriString === spec.ACTIVE_FILE_URI) { continue; }

            const uri = vscode.Uri.parse(uriString);

            // find all items from each storage.
            for (const [itemKind, map] of storage.entries()) {
                const symbolKind = spec.getSymbolKindFromReferenceItemKind(itemKind);
                for (const [identifier, item] of map.entries()) {
                    if (query.length === 0 || regExp.test(identifier)) {
                        if (item.location) {
                            const name = (itemKind === spec.ReferenceItemKind.Function) ? identifier + '()' : identifier;
                            const location = new vscode.Location(uri, spec.convertRange(item.location));
                            symbols.push(new vscode.SymbolInformation(name, symbolKind, '', location));
                        }
                    }
                }
            }
        }
        return symbols;
    }
}
