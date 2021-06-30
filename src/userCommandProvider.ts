import * as vscode from 'vscode';
import { TextDecoder } from 'util';
import * as estree from "estree";
import * as estraverse from "estraverse";
import * as spec from "./spec";
import { CommandProvider } from "./commandProvider";
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

interface CustomProgram extends estree.Program {
    exDiagnostics: { location: IFileRange, message: string, severity: vscode.DiagnosticSeverity }[];
}

/**
 * @param tree Parser AST object
 * @param position the current cursor position. If not given, top-level symbols (global variables, constant, macro and functions) are picked up.
 */
function collectSymbolsFromTree(tree: estree.Program, position?: vscode.Position): spec.ReferenceStorage {

    const constantRefMap: spec.ReferenceMap = new Map();
    const variableRefMap: spec.ReferenceMap = new Map();
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

            const nodeRange = currentNode.loc ? spec.convertRange(<IFileRange>currentNode.loc) : undefined;
            let refItem: spec.ReferenceItem | undefined;
            const refItems: spec.ReferenceItem[] = [];

            if (!nodeRange) {
                console.log('Statement should have location. This may be a bug in the parser.');
                return;
            }

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
                            refItem = { signature: param.name, location: <IFileRange>currentNode.loc };
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
                        refItems.push(refItem);
                    }

                } else {
                    // register the id as a traditional macro if parameter is null.
                    if (!position || (parentNode && parentNode.type !== 'Program')) {
                        refItem = { signature: currentNode.id.name, location: <IFileRange>currentNode.loc };
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
                            refItem = { signature: signatureStr, location: <IFileRange>currentNode.loc };
                            if (currentNode.kind === 'const') {
                                constantRefMap.set(declarator.id.name, refItem);
                            } else {
                                variableRefMap.set(declarator.id.name, refItem);
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

    return new Map(
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
    const map: Map<string, { diagnoseProblems: boolean }> = new Map();

    if (workspaceFolders) {
        for (const workspaceFolder of workspaceFolders) {
            const config = vscode.workspace.getConfiguration('spec-command.workspace', workspaceFolder);
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
                const config = vscode.workspace.getConfiguration('spec-command.command', workspaceFolder.uri);
                const prefix = config.get<string>('filePathPrefixInTerminal', '');
                path = prefix + vscode.workspace.asRelativePath(uri, false);
            } else {
                path = uri.path;
            }

            // send a command to the active terminal.
            terminal.show(true);
            terminal.sendText(`qdofile("${path}")`);
        };

        // a hander invoked when the document is changed
        const onDidChangeTextDocumentListener = (event: vscode.TextDocumentChangeEvent) => {
            const document = event.document;
            if (vscode.languages.match(spec.CMD_SELECTOR, document)) {
                this.parseDocumentContents(document.getText(), document.uri, true, true);
                // this.diagnoseOpenDocments();
            }
        };

        // a hander invoked when the document is opened
        // this is also invoked after the user manually changed the language id
        const onDidOpenTextDocumentListener = (document: vscode.TextDocument) => {
            if (vscode.languages.match(spec.CMD_SELECTOR, document)) {
                this.parseDocumentContents(document.getText(), document.uri, true, true);
            }
        };

        // a hander invoked when the document is saved
        const onDidSaveTextDocumentListener = (document: vscode.TextDocument) => {
            if (vscode.languages.match(spec.CMD_SELECTOR, document)) {
                this.parseDocumentContents(document.getText(), document.uri, true, true);
            }
        };

        // a hander invoked when the document is closed
        // this is also invoked after the user manually changed the language id
        const onDidCloseTextDocumentListener = async (document: vscode.TextDocument) => {
            if (vscode.languages.match(spec.CMD_SELECTOR, document)) {
                const uriString = document.uri.toString();

                this.treeCollection.delete(uriString);

                // check whether the file is in a workspace folder. If not in a folder, delete from the database.
                const filesInWorkspaces = await findFilesInWorkspaces();
                const fileMetadata = filesInWorkspaces.get(document.uri.toString());
                if (fileMetadata) {
                    // if file also exists in a workspace folder,
                    // clear diagnostics if setting for workspace.diagnoseProblem is false. 
                    if (!fileMetadata.diagnoseProblems) {
                        this.diagnosticCollection.delete(document.uri);
                    }
                } else {
                    // if file does not exist in a workspace folder, clear all.
                    this.storageCollection.delete(uriString);
                    this.diagnosticCollection.delete(document.uri);
                    this.completionItemCollection.delete(uriString);
                }
            }
        };

        // // a hander invoked after files are created
        // const onDidCreateFilesListener = async (event: vscode.FileCreateEvent) => {
        //     const filesInWorkspaces = await findFilesInWorkspaces();

        //     const newFiles: Map<string, { diagnoseProblems: boolean }> = new Map();
        //     for (const newFileUri of event.files) {
        //     }
        // };

        // a hander invoked after files are renamed
        const onDidRenameFilesListener = async (event: vscode.FileRenameEvent) => {
            const filesInWorkspaces = await findFilesInWorkspaces();
            const oldFiles: Set<string> = new Set();
            const newFiles: Map<string, { diagnoseProblems: boolean }> = new Map();

            for (const { oldUri, newUri } of event.files) {
                const stat = await vscode.workspace.fs.stat(newUri);

                if (stat.type === vscode.FileType.File) {
                    oldFiles.add(oldUri.toString());
                    const newFileMetadata = filesInWorkspaces.get(newUri.toString());
                    if (newFileMetadata) {
                        newFiles.set(newUri.toString(), newFileMetadata);
                    }
                } else if (stat.type === vscode.FileType.Directory) {
                    const oldDirUriString = oldUri.toString() + "/";

                    for (const fileUriString of this.storageCollection.keys()) {
                        if (fileUriString.startsWith(oldDirUriString)) {
                            oldFiles.add(fileUriString);
                        }
                    }

                    const newDirUriString = newUri.toString() + "/";
                    for (const [fileUriString, fileMetadata] of filesInWorkspaces) {
                        if (fileUriString.startsWith(newDirUriString)) {
                            newFiles.set(fileUriString, fileMetadata);
                        }
                    }
                }
            }

            this.applyFileOperation(oldFiles, newFiles);
        };

        // a hander invoked before files are deleted
        const onWillDeleteFilesListener = async (event: vscode.FileWillDeleteEvent) => {
            for (const oldUri of event.files) {
                const promise = vscode.workspace.fs.stat(oldUri).then(
                    stat => {
                        const oldFiles: Set<string> = new Set();
                        if (stat.type === vscode.FileType.File) {
                            oldFiles.add(oldUri.toString());
                        } else if (stat.type === vscode.FileType.Directory) {
                            const oldDirUriString = oldUri.toString() + "/";

                            for (const fileUriString of this.storageCollection.keys()) {
                                if (fileUriString.startsWith(oldDirUriString)) {
                                    oldFiles.add(fileUriString);
                                }
                            }
                        }
                        this.applyFileOperation(oldFiles);
                    }
                );
                event.waitUntil(promise);
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
            if (event.affectsConfiguration('spec-command.workspace')) {
                this.refreshCollections();
            }
        };

        const onDidChangeWorkspaceFoldersListener = (event: vscode.WorkspaceFoldersChangeEvent) => {
            this.refreshCollections();
        };

        context.subscriptions.push(
            // register command handlers
            vscode.commands.registerCommand('spec-command.execSelectionInTerminal', execSelectionInTerminalCommandCallback),
            vscode.commands.registerCommand('spec-command.execFileInTerminal', execFileInTerminalCommandCallback),
            // register document-event listeners
            vscode.workspace.onDidChangeTextDocument(onDidChangeTextDocumentListener),
            vscode.workspace.onDidOpenTextDocument(onDidOpenTextDocumentListener),
            vscode.workspace.onDidSaveTextDocument(onDidSaveTextDocumentListener),
            vscode.workspace.onDidCloseTextDocument(onDidCloseTextDocumentListener),
            // vscode.window.onDidChangeActiveTextEditor(onDidChangeActiveTextEditorListener),
            // register file-event listeners
            // vscode.workspace.onDidCreateFiles(onDidCreateFilesListener),
            vscode.workspace.onDidRenameFiles(onDidRenameFilesListener),
            vscode.workspace.onWillDeleteFiles(onWillDeleteFilesListener),
            // register other event listeners
            vscode.workspace.onDidChangeConfiguration(onDidChangeConfigurationListener),
            vscode.workspace.onDidChangeWorkspaceFolders(onDidChangeWorkspaceFoldersListener),
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

    // update the metadata database.
    // All metadata for files in oldFiles are removed. Mismatched files are just ignored.
    // All metadata for newFiles are created thus the file paths should be filtered beforehand
    // based on the configuration settings.
    private async applyFileOperation(oldFiles?: Set<string>, newFiles?: Map<string, { diagnoseProblems: boolean }>) {
        // unregister metadata for old URIs.
        if (oldFiles) {
            for (const oldFileUriString of oldFiles) {
                this.storageCollection.delete(oldFileUriString);
                this.diagnosticCollection.delete(vscode.Uri.parse(oldFileUriString));
                this.completionItemCollection.delete(oldFileUriString);
            }
        }

        // register metadata for new URIs.
        if (newFiles) {
            // make a list of opened documents.
            // Do nothing for these files because they are handled by
            // onDidOpenTextDocument and onDidCloseTextDocument events.
            const openedFiles = new Set<string>();
            for (const document of vscode.workspace.textDocuments) {
                if (vscode.languages.match(spec.CMD_SELECTOR, document)) {
                    openedFiles.add(document.uri.toString());
                }
            }

            for (const [newFileUriString, newFileMetadata] of newFiles) {
                if (!openedFiles.has(newFileUriString)) {
                    const newFileUri = vscode.Uri.parse(newFileUriString);
                    const contents = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(newFileUri));
                    this.parseDocumentContents(contents, newFileUri, false, newFileMetadata.diagnoseProblems);
                }
            }
        }
    }

    // 
    private parseDocumentContents(contents: string, uri: vscode.Uri, isOpenDocument: boolean, diagnoseProblems: boolean) {
        const uriString = uri.toString();

        let tree;
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
        const openedFiles = new Set<string>();
        for (const document of vscode.workspace.textDocuments) {
            if (vscode.languages.match(spec.CMD_SELECTOR, document)) {
                this.parseDocumentContents(document.getText(), document.uri, true, true);
                openedFiles.add(document.uri.toString());
            }
        }

        // parse the other files in workspace folders.
        const filesInWorkspaces = await findFilesInWorkspaces();

        for (const [fileUriString, fileMetadata] of filesInWorkspaces) {
            if (!openedFiles.has(fileUriString)) {
                const fileUri = vscode.Uri.parse(fileUriString);
                const contents = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(fileUri));
                this.parseDocumentContents(contents, fileUri, false, fileMetadata.diagnoseProblems);
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
            const symbolKind = spec.getReferenceItemKindMetadata(itemKind).symbolKind;
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
                const symbolKind = spec.getReferenceItemKindMetadata(itemKind).symbolKind;
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
