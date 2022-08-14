/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import * as estree from "estree";
import * as estraverse from "estraverse";
import * as spec from "./spec";
import { CommandProvider } from "./commandProvider";
import { SyntaxError, parse, IFileRange } from './grammar';
import { getTextDecoder } from './textEncoding';

/**
 * Extention-specific keys for estraverse (not exist in the original Parser AST.)
 */
const ADDITIONAL_TRAVERSE_KEYS = {
    MacroStatement: ['arguments'],
    InvalidStatement: [],
    ExitStatement: [],
    NullExpression: [],
};

interface CustomProgram extends estree.Program {
    exDiagnostics: { location: IFileRange, message: string, severity: vscode.DiagnosticSeverity }[];
}

async function findFilesInWorkspaces() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const uriStringSet = new Set<string>();

    if (workspaceFolders) {
        for (const workspaceFolder of workspaceFolders) {
            // refer to `files.associations` configuration property
            const associations = Object.assign(
                <Record<string, string>>{ '*.mac': 'spec-command' },
                vscode.workspace.getConfiguration('files', workspaceFolder).get<Record<string, string>>('associations')
            );

            for (const [key, value] of Object.entries(associations)) {
                const inclusivePattern = new vscode.RelativePattern(workspaceFolder, (key.includes('/') ? key : `**/${key}`));
                if (value === 'spec-command') {
                    for (const uri of await vscode.workspace.findFiles(inclusivePattern)) {
                        uriStringSet.add(uri.toString());
                    }
                } else {
                    for (const uri of await vscode.workspace.findFiles(inclusivePattern)) {
                        uriStringSet.delete(uri.toString());
                    }
                }
            }
        }
    }
    return uriStringSet;
}

/**
 * Provider class for user documents.
 * This class manages opened documents and other documents in the current workspace.
 */
export class UserCommandProvider extends CommandProvider implements vscode.DefinitionProvider, vscode.DocumentSymbolProvider, vscode.WorkspaceSymbolProvider {

    private readonly diagnosticCollection: vscode.DiagnosticCollection;
    private readonly treeCollection: Map<string, CustomProgram>;

    constructor(context: vscode.ExtensionContext) {
        super(context);

        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('spec-command');
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
        const execFileInTerminalCommandCallback = (...args: unknown[]) => {
            // if (!vscode.workspace.isTrusted) {
            //     vscode.window.showErrorMessage('The command is prohibited in untrusted workspaces.');
            //     return;
            // }

            // find active terminal.
            const terminal = vscode.window.activeTerminal;
            if (!terminal) {
                vscode.window.showErrorMessage('Active terminal is not found.');
                return;
            }

            // find a file uri.
            // If uri is given as an argument, use it. Else, use uri of the active editor.
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

            // adjust path. Append prefix in the configuration for relative path.
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
            let path: string;
            if (workspaceFolder) {
                const prefix = vscode.workspace.getConfiguration('spec-command.terminal', workspaceFolder).get<string>('filePathPrefix', '');
                path = prefix + vscode.workspace.asRelativePath(uri, false);
            } else {
                path = uri.path;
            }

            // Sanitization of a string surrounded by double quoataions in a POSIX shell
            // ('\' -> '\\', '"' -> '\"')
            path = path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

            // send a command to the active terminal.
            terminal.show(true);
            terminal.sendText(`qdofile("${path}")`);
        };

        // a hander invoked when the document is changed
        const textDocumentChangeListener = (event: vscode.TextDocumentChangeEvent) => {
            const document = event.document;
            if (vscode.languages.match(spec.CMD_SELECTOR, document) && document.uri.scheme !== 'git') {
                this.parseDocumentContents(document.getText(), document.uri, true, true);
                // this.diagnoseOpenDocments();
            }
        };

        // a hander invoked when the document is opened
        // this is also invoked after the user manually changed the language id
        const textDocumentOpenListener = (document: vscode.TextDocument) => {
            if (vscode.languages.match(spec.CMD_SELECTOR, document) && document.uri.scheme !== 'git') {
                this.parseDocumentContents(document.getText(), document.uri, true, true);
            }
        };

        // a hander invoked when the document is saved
        const textDocumentSaveListener = (document: vscode.TextDocument) => {
            if (vscode.languages.match(spec.CMD_SELECTOR, document) && document.uri.scheme !== 'git') {
                this.parseDocumentContents(document.getText(), document.uri, true, true);
            }
        };

        // a hander invoked when the document is closed
        // this is also invoked after the user manually changed the language id
        const textDocumentCloseListener = async (document: vscode.TextDocument) => {
            if (vscode.languages.match(spec.CMD_SELECTOR, document)) {
                const documentUriString = document.uri.toString();

                this.treeCollection.delete(documentUriString);

                // check whether the file is in a workspace folder. If not in a folder, delete from the database.
                const filesInWorkspaces = await findFilesInWorkspaces();
                if (filesInWorkspaces.has(documentUriString)) {
                    // if file also exists in a workspace folder...
                    // clear diagnostics if setting for workspace.diagnoseProblem is false. 
                    const diagnoseInWorkspace = vscode.workspace.getConfiguration('spec-command.workspace', document).get<boolean>('diagnoseProblems', false);
                    if (!diagnoseInWorkspace) {
                        this.diagnosticCollection.delete(document.uri);
                    }
                } else {
                    // if file does not exist in a workspace folder, clear all.
                    this.storageCollection.delete(documentUriString);
                    this.diagnosticCollection.delete(document.uri);
                    this.completionItemCollection.delete(documentUriString);
                }
            }
        };

        // // a hander invoked after files are created
        // const fileCreateListener = async (event: vscode.FileCreateEvent) => {
        //     const filesInWorkspaces = await findFilesInWorkspaces();
        //     const newUriStringSet = new Set<string>();
        //     for (const newUri of event.files) {
        //     }
        // };

        // a hander invoked after files are renamed
        const fileRenameListener = async (event: vscode.FileRenameEvent) => {
            const filesInWorkspaces = await findFilesInWorkspaces();
            const oldUriStringSet = new Set<string>();
            const newUriStringSet = new Set<string>();

            for (const { oldUri, newUri } of event.files) {
                const stat = await vscode.workspace.fs.stat(newUri);

                if (stat.type === vscode.FileType.File) {
                    oldUriStringSet.add(oldUri.toString());
                    if (filesInWorkspaces.has(newUri.toString())) {
                        newUriStringSet.add(newUri.toString());
                    }
                } else if (stat.type === vscode.FileType.Directory) {
                    const oldDirUriString = oldUri.toString() + "/";

                    for (const fileUriString of this.storageCollection.keys()) {
                        if (fileUriString.startsWith(oldDirUriString)) {
                            oldUriStringSet.add(fileUriString);
                        }
                    }

                    const newDirUriString = newUri.toString() + "/";
                    for (const fileUriString of filesInWorkspaces) {
                        if (fileUriString.startsWith(newDirUriString)) {
                            newUriStringSet.add(fileUriString);
                        }
                    }
                }
            }

            this.applyFileOperation(oldUriStringSet, newUriStringSet);
        };

        // a hander invoked before files are deleted
        const fileWillDeleteListener = async (event: vscode.FileWillDeleteEvent) => {
            for (const oldUri of event.files) {
                const promise = vscode.workspace.fs.stat(oldUri).then(
                    stat => {
                        const oldUriStringSet = new Set<string>();
                        if (stat.type === vscode.FileType.File) {
                            oldUriStringSet.add(oldUri.toString());
                        } else if (stat.type === vscode.FileType.Directory) {
                            const oldDirUriString = oldUri.toString() + "/";

                            for (const fileUriString of this.storageCollection.keys()) {
                                if (fileUriString.startsWith(oldDirUriString)) {
                                    oldUriStringSet.add(fileUriString);
                                }
                            }
                        }
                        this.applyFileOperation(oldUriStringSet);
                    }
                );
                event.waitUntil(promise);
            }
        };

        // const activeTextEditorChangeListener = (editor: vscode.TextEditor | undefined) => {
        //     if (editor) {
        //         const document = editor.document;
        //         this.parseDocumentContents(document.getText(), document.uri, true, true);
        //     }
        // };

        // a hander invoked when the configuration is changed
        const configurationChangeListener = (event: vscode.ConfigurationChangeEvent) => {
            if (event.affectsConfiguration('spec-command.workspace') || event.affectsConfiguration('files.associations') || event.affectsConfiguration('files.encoding')) {
                this.refreshCollections();
            }
        };

        const workspaceFoldersChangeListener = (event: vscode.WorkspaceFoldersChangeEvent) => {
            this.refreshCollections();
        };

        context.subscriptions.push(
            // register command handlers
            vscode.commands.registerCommand('spec-command.execSelectionInTerminal', execSelectionInTerminalCommandCallback),
            vscode.commands.registerCommand('spec-command.execFileInTerminal', execFileInTerminalCommandCallback),
            // register document-event listeners
            vscode.workspace.onDidChangeTextDocument(textDocumentChangeListener),
            vscode.workspace.onDidOpenTextDocument(textDocumentOpenListener),
            vscode.workspace.onDidSaveTextDocument(textDocumentSaveListener),
            vscode.workspace.onDidCloseTextDocument(textDocumentCloseListener),
            // vscode.window.onDidChangeActiveTextEditor(activeTextEditorChangeListener),
            // register file-event listeners
            // vscode.workspace.onDidCreateFiles(fileCreateListener),
            vscode.workspace.onDidRenameFiles(fileRenameListener),
            vscode.workspace.onWillDeleteFiles(fileWillDeleteListener),
            // register other event listeners
            vscode.workspace.onDidChangeConfiguration(configurationChangeListener),
            vscode.workspace.onDidChangeWorkspaceFolders(workspaceFoldersChangeListener),
            // register providers
            vscode.languages.registerDefinitionProvider(spec.CMD_SELECTOR, this),
            vscode.languages.registerDocumentSymbolProvider(spec.CMD_SELECTOR, this),
            vscode.languages.registerWorkspaceSymbolProvider(this),
            // register diagnostic collection
            this.diagnosticCollection,
        );

        // asynchronously scan files and refresh the collection
        this.refreshCollections();
    }

    /**
     * update the metadata database.
     * All metadata for oldFiles are removed. Mismatched files are just ignored.
     * All metadata for newFiles are created thus the file paths should be filtered beforehand
     * based on the configuration settings.
     */
    private async applyFileOperation(oldUriStringSet?: Set<string>, newUriStringSet?: Set<string>) {
        // unregister metadata for old URIs.
        if (oldUriStringSet) {
            for (const oldUriString of oldUriStringSet) {
                this.storageCollection.delete(oldUriString);
                this.diagnosticCollection.delete(vscode.Uri.parse(oldUriString));
                this.completionItemCollection.delete(oldUriString);
            }
        }

        // register metadata for new URIs.
        if (newUriStringSet) {
            // make a list of opened documents.
            // Do nothing for these files because they are handled by
            // onDidOpenTextDocument and onDidCloseTextDocument events.
            const documentUriStringSet = new Set<string>();
            for (const document of vscode.workspace.textDocuments) {
                if (vscode.languages.match(spec.CMD_SELECTOR, document) && document.uri.scheme !== 'git') {
                    documentUriStringSet.add(document.uri.toString());
                }
            }
            for (const newUriString of newUriStringSet) {
                if (!documentUriStringSet.has(newUriString)) {
                    const newUri = vscode.Uri.parse(newUriString);
                    const textDecoder = getTextDecoder({ languageId: 'spec-command', uri: newUri });
                    const contents = textDecoder.decode(await vscode.workspace.fs.readFile(newUri));
                    const diagnoseInWorkspace = vscode.workspace.getConfiguration('spec-command.workspace', newUri).get<boolean>('diagnoseProblems', false);
                    this.parseDocumentContents(contents, newUri, false, diagnoseInWorkspace);
                }
            }
        }
    }

    /**
     * @param tree Parser AST object.
     * @param uriString document URI string.
     * @param position the current cursor position. If not given, top-level symbols (global variables, constant, macro and functions) are picked up.
     */
     private collectSymbolsFromTree(tree: estree.Program, uriString: string, position?: vscode.Position) {

        const constantRefMap: spec.ReferenceMap = new Map();
        const variableRefMap: spec.ReferenceMap = new Map();
        const arrayRefMap: spec.ReferenceMap = new Map();
        const macroRefMap: spec.ReferenceMap = new Map();
        const functionRefMap: spec.ReferenceMap = new Map();

        // const nestedNodes: string[] = [];

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

                if (!currentNode.loc) {
                    console.log('Statement should have location. This may be a bug in the parser.');
                    return;
                }
                const nodeRange = spec.convertRange(currentNode.loc as IFileRange);
                let refItem: spec.ReferenceItem | undefined;
                const refItems: spec.ReferenceItem[] = [];

                if (position) {
                    // in case of active document
                    // if (nodeRange.contains(position)) {
                    //     nestedNodes.push(currentNode.type);
                    // }

                    if (currentNode.type === 'BlockStatement' && nodeRange.end.isBefore(position)) {
                        // skip the code block that ends before the cursor.
                        return estraverse.VisitorOption.Skip;

                    } else if (currentNode.type === 'FunctionDeclaration' && currentNode.params && nodeRange.contains(position)) {
                        // register arguments of function as variables if the cursor is in the function block.
                        for (const param of currentNode.params) {
                            if (param.type === 'Identifier') {
                                refItem = { signature: param.name, location: currentNode.loc as IFileRange };
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
                            refItem = { signature: signatureStr, location: currentNode.loc as IFileRange };
                            functionRefMap.set(currentNode.id.name, refItem);
                            refItems.push(refItem);
                        }

                    } else {
                        // register the id as a traditional macro if parameter is null.
                        if (!position || (parentNode && parentNode.type !== 'Program')) {
                            refItem = { signature: currentNode.id.name, location: currentNode.loc as IFileRange };
                            macroRefMap.set(currentNode.id.name, refItem);
                            refItems.push(refItem);
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
                                refItem = { signature: signatureStr, location: currentNode.loc as IFileRange };
                                if (currentNode.kind === 'const') {
                                    constantRefMap.set(declarator.id.name, refItem);
                                } else if (currentNode.kind === 'let') {
                                    variableRefMap.set(declarator.id.name, refItem);
                                } else {
                                    arrayRefMap.set(declarator.id.name, refItem);
                                }
                                refItems.push(refItem);
                            }
                        }
                    }
                }

                // add docstrings
                if (refItems.length > 0 && currentNode.leadingComments && currentNode.leadingComments.length > 0) {
                    for (const refItem of refItems) {
                        refItem.description = currentNode.leadingComments[currentNode.leadingComments.length - 1].value;
                    }
                }

                if (!position) {
                    // in case of inactive document
                    // only scan the top-level items
                    if (parentNode && parentNode.type === 'Program') {
                        return estraverse.VisitorOption.Skip;
                    }
                }
            },
            // leave: (currentNode, parentNode) => {
            //     console.log('leave', currentNode.type, parentNode && parentNode.type);
            // },
            keys: ADDITIONAL_TRAVERSE_KEYS,
        });

        this.storageCollection.set(uriString, new Map(
               [
                   [spec.ReferenceItemKind.Constant, constantRefMap],
                   [spec.ReferenceItemKind.Variable, variableRefMap],
                   [spec.ReferenceItemKind.Array, arrayRefMap],
                   [spec.ReferenceItemKind.Macro, macroRefMap],
                   [spec.ReferenceItemKind.Function, functionRefMap],
               ]
           )
        );
    }

    // 
    private parseDocumentContents(contents: string, uri: vscode.Uri, isOpenDocument: boolean, diagnoseProblems: boolean) {
        const uriString = uri.toString();

        let tree: CustomProgram;
        try {
            tree = parse(contents);
        } catch (error) {
            if (error instanceof SyntaxError) {
                if (diagnoseProblems) {
                    const diagnostic = new vscode.Diagnostic(spec.convertRange(error.location), error.message, vscode.DiagnosticSeverity.Error);
                    this.diagnosticCollection.set(uri, [diagnostic]);
                    // this.updateCompletionItemsForUriString(uriString);
                }
            } else {
                console.log('Unknown error in sytax parsing', error);
                if (diagnoseProblems) {
                    const diagnostic = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), 'Unknown error in sytax parsing', vscode.DiagnosticSeverity.Error);
                    this.diagnosticCollection.set(uri, [diagnostic]);
                }

            }
            // update with an empty map object.
            this.storageCollection.set(uriString, new Map());
            return false;
        }
        // console.log(JSON.stringify(tree, null, 2));

        if (diagnoseProblems) {
            const diagnostics = tree.exDiagnostics.map(item => new vscode.Diagnostic(spec.convertRange(item.location), item.message, item.severity));
            this.diagnosticCollection.set(uri, diagnostics);
        }

        if (isOpenDocument) {
            this.treeCollection.set(uriString, tree);
        }

        this.collectSymbolsFromTree(tree, uriString);
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
        const documentUriStringSet = new Set<string>();
        for (const document of vscode.workspace.textDocuments) {
            if (vscode.languages.match(spec.CMD_SELECTOR, document) && document.uri.scheme !== 'git') {
                this.parseDocumentContents(document.getText(), document.uri, true, true);
                documentUriStringSet.add(document.uri.toString());
            }
        }

        // parse the other files in workspace folders.
        const filesInWorkspaces = await findFilesInWorkspaces();

        for (const uriString of filesInWorkspaces) {
            if (!documentUriStringSet.has(uriString)) {
                const uri = vscode.Uri.parse(uriString);
                const textDecoder = getTextDecoder({ languageId: 'spec-command', uri: uri });
                const contents = textDecoder.decode(await vscode.workspace.fs.readFile(uri));
                const diagnoseInWorkspace = vscode.workspace.getConfiguration('spec-command.workspace', uri).get<boolean>('diagnoseProblems', false);
                this.parseDocumentContents(contents, uri, false, diagnoseInWorkspace);
            }
        }
    }

    /**
     * Required implementation of vscode.CompletionItemProvider, overriding the super class
     */
    public provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.ProviderResult<vscode.CompletionList<spec.CompletionItem> | spec.CompletionItem[]> {
        if (token.isCancellationRequested) { return; }

        const tree = this.treeCollection.get(document.uri.toString());
        if (tree) {
            this.collectSymbolsFromTree(tree, spec.ACTIVE_FILE_URI, position);
            this.updateCompletionItemsForUriString(spec.ACTIVE_FILE_URI);
        }
        return super.provideCompletionItems(document, position, token, context);
    }

    /**
     * Required implementation of vscode.HoverProvider, overriding the super class
     */
    public provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Hover> {
        if (token.isCancellationRequested) { return; }

        const tree = this.treeCollection.get(document.uri.toString());
        if (tree) {
            this.collectSymbolsFromTree(tree, spec.ACTIVE_FILE_URI, position);
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
            this.collectSymbolsFromTree(tree, spec.ACTIVE_FILE_URI, position);
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
            const symbolKind = spec.getReferenceItemKindMetadata(itemKind).symbolKind;
            for (const [identifier, refItem] of map.entries()) {
                if (refItem.location) {
                    const location = new vscode.Location(document.uri, spec.convertRange(refItem.location));
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
                const symbolKind = spec.getReferenceItemKindMetadata(itemKind).symbolKind;
                for (const [identifier, refItem] of map.entries()) {
                    if (query.length === 0 || regExp.test(identifier)) {
                        if (refItem.location) {
                            const name = (itemKind === spec.ReferenceItemKind.Function) ? identifier + '()' : identifier;
                            const location = new vscode.Location(uri, spec.convertRange(refItem.location));
                            symbols.push(new vscode.SymbolInformation(name, symbolKind, '', location));
                        }
                    }
                }
            }
        }
        return symbols;
    }
}
