import * as vscode from 'vscode';
import * as lang from './language';
import { Controller } from './controller';
import { BuiltInController } from './builtInController';
import { traversePartially, traverseWholly, traverseForFurtherDiagnostics } from './traverser';
import { SyntaxError, parse } from './parser';
import type * as tree from './tree';


/**
 * Get a set of the URIs of supported files from workspaces
 * 
 * @returns a promise of a set of URI strings
 */
async function findFilesInWorkspaces() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const uriStringSet = new Set<string>();

    if (workspaceFolders) {
        for (const workspaceFolder of workspaceFolders) {
            // refer to `files.associations` configuration property
            const associations: Record<string, string> = Object.assign(
                { '*.mac': 'spec-command' },
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
 * A controller subclass that handles files and documents in the current workspace.
 */
export class FileController extends Controller implements vscode.DefinitionProvider, vscode.DocumentSymbolProvider, vscode.WorkspaceSymbolProvider, vscode.DocumentDropEditProvider, vscode.TextDocumentContentProvider {

    private readonly diagnosticCollection: vscode.DiagnosticCollection;
    private readonly treeCollection: Map<string, tree.Program>;
    private readonly symbolCollection: Map<string, vscode.DocumentSymbol[]>;
    private readonly builtInController: BuiltInController;

    constructor(context: vscode.ExtensionContext, builtInController: BuiltInController) {
        super(context);
        this.builtInController = builtInController;

        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('spec-command');
        this.treeCollection = new Map();
        this.symbolCollection = new Map();

        const showWorkspaceSymbolsJsonCommandHandler = async () => {
            await this.refreshCollections();

            const categories = ['variable', 'constant', 'array', 'macro', 'function'] as const;
            const obj: Record<typeof categories[number], Record<string, lang.ReferenceItem>> = { variable: {}, constant: {}, array: {}, macro: {}, function: {}, };
            for (const [uriString, refBook] of this.referenceCollection.entries()) {
                // local variables are not exported.
                if (uriString === lang.ACTIVE_FILE_URI) { continue; }

                for (const [category, refSheet] of Object.entries(refBook)) {
                    const category2 = category as keyof typeof refBook;
                    if (category2 === 'variable' || category2 === 'constant' || category2 === 'array' || category2 === 'macro' || category2 === 'function') {
                        obj[category2] = Object.assign(obj[category2], Object.fromEntries(refSheet));
                    }
                }
            }
            const content = JSON.stringify(obj, (key, value) => { return key === 'location' ? undefined : value; }, 2);
            const document = await vscode.workspace.openTextDocument({ language: 'json', content: content });
            vscode.window.showTextDocument(document, { preview: false });
        };

        const inspectSyntaxTreeCommandHandler = () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'spec-command') {
                const uri = vscode.Uri.parse(lang.AST_URI).with({ query: editor.document.uri.toString() });
                vscode.window.showTextDocument(uri, { preview: false });
            }
        };

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

        /**  Event handler invoked when the document is changed. */
        const textDocumentDidChangeListener = (event: vscode.TextDocumentChangeEvent) => {
            const document = event.document;
            if (vscode.languages.match(lang.SELECTOR, document) && document.uri.scheme !== 'git') {
                this.parseDocumentContents(document.getText(), document.uri, true, true, true);
            }
        };

        /**
         * Event handler invoked when the document is opened.
         * It is also invoked after the user manually changed the language identifier.
         */
        const textDocumentDidOpenListener = (document: vscode.TextDocument) => {
            if (vscode.languages.match(lang.SELECTOR, document) && document.uri.scheme !== 'git') {
                this.parseDocumentContents(document.getText(), document.uri, true, true, true);
            }
        };

        /** Event handler invoked when the document is saved. */
        const textDocumentDidSaveListener = (document: vscode.TextDocument) => {
            if (vscode.languages.match(lang.SELECTOR, document) && document.uri.scheme !== 'git') {
                this.parseDocumentContents(document.getText(), document.uri, true, true, true);
            }
        };

        /**
         * Event handler invoked when the document is closed.
         * It is also invoked after the user manually changed the language identifier.
         */
        const textDocumentDidCloseListener = async (document: vscode.TextDocument) => {
            if (vscode.languages.match(lang.SELECTOR, document)) {
                const documentUriString = document.uri.toString();

                this.treeCollection.delete(documentUriString);
                this.symbolCollection.delete(documentUriString);

                // check whether the file is in a workspace folder.
                // If not in a folder, delete from the database.
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
                    this.referenceCollection.delete(documentUriString);
                    this.completionItemCollection.delete(documentUriString);
                    this.diagnosticCollection.delete(document.uri);
                }
            }
        };

        // const activeTextEditorDidChangeListener = (editor: vscode.TextEditor | undefined) => { };

        // const fileDidCreateListener = async (event: vscode.FileCreateEvent) => { };

        /** Event handler invoked after files are renamed. */
        const fileDidRenameListener = async (event: vscode.FileRenameEvent) => {
            const filesInWorkspaces = await findFilesInWorkspaces();
            let oldUriStrings: Array<string> | undefined;
            let newUriStrings: Array<string> | undefined;

            for (const { oldUri, newUri } of event.files) {
                const stat = await vscode.workspace.fs.stat(newUri);
                if (stat.type === vscode.FileType.File) {
                    oldUriStrings = [oldUri.toString()];
                    if (filesInWorkspaces.has(newUri.toString())) {
                        newUriStrings = [newUri.toString()];
                    }
                } else if (stat.type === vscode.FileType.Directory) {
                    const oldDir = oldUri.toString() + '/';
                    oldUriStrings = [...this.referenceCollection.keys()].filter(uriString => uriString.startsWith(oldDir));
                    const newDir = newUri.toString() + '/';
                    newUriStrings = [...filesInWorkspaces].filter(uriString => uriString.startsWith(newDir));
                }
            }

            this.reflectFileOperationInCollections(oldUriStrings, newUriStrings);
        };

        /** Event handler invoked before files are deleted. */
        const fileWillDeleteListener = async (event: vscode.FileWillDeleteEvent) => {
            for (const oldUri of event.files) {
                const promise = vscode.workspace.fs.stat(oldUri).then(
                    stat => {
                        let oldUriStrings: Array<string> | undefined;
                        if (stat.type === vscode.FileType.File) {
                            oldUriStrings = [oldUri.toString()];
                        } else if (stat.type === vscode.FileType.Directory) {
                            const oldDir = oldUri.toString() + '/';
                            oldUriStrings = [...this.referenceCollection.keys()].filter(uriString => uriString.startsWith(oldDir));
                        }
                        this.reflectFileOperationInCollections(oldUriStrings);
                    }
                );
                event.waitUntil(promise);
            }
        };

        /** Event handler invoked when the configuration is changed. */
        const configurationDidChangeListener = (event: vscode.ConfigurationChangeEvent) => {
            if (event.affectsConfiguration('spec-command.workspace') || event.affectsConfiguration('files.associations') || event.affectsConfiguration('files.encoding') || event.affectsConfiguration('spec-command.problems.rules')) {
                this.refreshCollections();
            }
        };

        /** Event handler invoked when the workspace folders are changed. */
        const workspaceFoldersDidChangeListener = (event: vscode.WorkspaceFoldersChangeEvent) => {
            this.refreshCollections();
        };

        // asynchronously scan files and refresh the collection
        this.refreshCollections();

        // Register providers and event handlers.
        context.subscriptions.push(
            // Register command handlers.
            vscode.commands.registerCommand('spec-command.showWorkspaceSymbolsJson', showWorkspaceSymbolsJsonCommandHandler),
            vscode.commands.registerCommand('spec-command.inspectSyntaxTree', inspectSyntaxTreeCommandHandler),
            vscode.commands.registerCommand('spec-command.execSelectionInTerminal', execSelectionInTerminalCommandCallback),
            vscode.commands.registerCommand('spec-command.execFileInTerminal', execFileInTerminalCommandCallback),

            // Register document-event listeners.
            vscode.workspace.onDidChangeTextDocument(textDocumentDidChangeListener),
            vscode.workspace.onDidOpenTextDocument(textDocumentDidOpenListener),
            vscode.workspace.onDidSaveTextDocument(textDocumentDidSaveListener),
            vscode.workspace.onDidCloseTextDocument(textDocumentDidCloseListener),
            // vscode.window.onDidChangeActiveTextEditor(activeTextEditorDidChangeListener),

            // Register file-event listeners.
            // vscode.workspace.onDidCreateFiles(fileDidCreateListener),
            vscode.workspace.onDidRenameFiles(fileDidRenameListener),
            vscode.workspace.onWillDeleteFiles(fileWillDeleteListener),

            // Register other event listeners.
            vscode.workspace.onDidChangeConfiguration(configurationDidChangeListener),
            vscode.workspace.onDidChangeWorkspaceFolders(workspaceFoldersDidChangeListener),

            // Register providers.
            vscode.languages.registerDefinitionProvider(lang.SELECTOR, this),
            vscode.languages.registerDocumentSymbolProvider(lang.SELECTOR, this),
            vscode.languages.registerWorkspaceSymbolProvider(this),
            vscode.languages.registerDocumentDropEditProvider(lang.SELECTOR, this),
            vscode.workspace.registerTextDocumentContentProvider('spec-command', this),

            // Register diagnostic collection.
            this.diagnosticCollection,
        );
    }

    /**
     * Update the database.
     * @param oldUriStrings An iterable collection of file URIs of which metadata will be removed. Mismatched files are just ignored.
     * @param newUriStrings An iterable collection of file URIs of which metadata will be created. The file paths should be filtered beforehand.
     */
    private reflectFileOperationInCollections(oldUriStrings?: Iterable<string>, newUriStrings?: Iterable<string>) {
        // Clear cache for old URIs.
        if (oldUriStrings) {
            for (const oldUriString of oldUriStrings) {
                this.referenceCollection.delete(oldUriString);
                this.completionItemCollection.delete(oldUriString);
                this.diagnosticCollection.delete(vscode.Uri.parse(oldUriString));
            }
        }

        // Parse files and store reference information for new URIs.
        if (newUriStrings) {
            // Do nothing for opened document files because they are handled by
            // `onDidOpenTextDocument` and `onDidCloseTextDocument` events.
            this.parseDocumentContentsOfUriStrings(newUriStrings, false);
        }
    }

    /**
     * scan open files and other files in workspace folders.
     * invoked manually when needed.
     */
    private async refreshCollections() {
        // Clear caches.
        this.referenceCollection.clear();
        this.completionItemCollection.clear();
        this.diagnosticCollection.clear();
        this.treeCollection.clear();
        this.symbolCollection.clear();

        // Parse documents opened by editors.
        return this.parseDocumentContentsOfUriStrings(await findFilesInWorkspaces(), true);
    }

    /**
     * Subroutine to parse the contents of multiple files specified by URIs.
     */
    private async parseDocumentContentsOfUriStrings(targetUriStrings: Iterable<string>, parseEditorDocuments: boolean) {
        // Collect URIs of documents in the editor and parse it if `parseEditorDocuments` is true.
        const documentUriStrings: string[] = [];
        const diagnosedUriStrings: string[] = [];

        const parseResults = new Map<string, { tree?: tree.Program, diagnostics?: vscode.Diagnostic[] }>();
        for (const document of vscode.workspace.textDocuments) {
            const uriString = document.uri.toString();
            if (vscode.languages.match(lang.SELECTOR, document) && document.uri.scheme !== 'git' && !documentUriStrings.includes(uriString)) {
                if (parseEditorDocuments) {
                    parseResults.set(uriString, this.parseDocumentContents(document.getText(), document.uri, true, true, false));
                    diagnosedUriStrings.push(uriString);
                }
                documentUriStrings.push(uriString);
            }
        }

        const nonDocumentUris: vscode.Uri[] = [];
        for (const uriString of targetUriStrings) {
            if (!documentUriStrings.includes(uriString)) {
                nonDocumentUris.push(vscode.Uri.parse(uriString));
            }
        }

        for (const uri of nonDocumentUris) {
            // const encoding = vscode.workspace.getConfiguration('files', { languageId: 'spec-command', uri: newUri }).get<string>('encoding', 'utf8');
            // const contents = await vscode.workspace.decode(await vscode.workspace.fs.readFile(newUri), { encoding });
            const contents = await vscode.workspace.decode(await vscode.workspace.fs.readFile(uri), { uri });
            const diagnoseInWorkspace = vscode.workspace.getConfiguration('spec-command.workspace', uri).get<boolean>('diagnoseProblems', false);
            parseResults.set(uri.toString(), this.parseDocumentContents(contents, uri, false, diagnoseInWorkspace, false));
            if (diagnoseInWorkspace) {
                diagnosedUriStrings.push(uri.toString());
            }
        }

        // Run additional analyses that use the whole database.
        // First, wait until the built-in and user-defined database files are loaded.
        await Promise.all([this.builtInController.promisedBuiltInRefBook, this.builtInController.promisedExternalRefBook]);

        const mergedReferenceCollection = new Map([...this.referenceCollection.entries(), ...this.builtInController.referenceCollection.entries()]);

        for (const uriString of diagnosedUriStrings) {
            const uri = vscode.Uri.parse(uriString);
            const diagnosticRules = vscode.workspace.getConfiguration('spec-command.problems', uri).get('rules', lang.defaultDiagnosticRules);
            if (diagnosticRules['no-undeclared-variable'] === true || diagnosticRules['no-undeclared-macro-argument'] === true) {
                const tree = parseResults.get(uriString)?.tree;
                let fundamentalDiagnostics = parseResults.get(uriString)?.diagnostics ?? [];
                if (tree) {
                    const additionalDiagnostics = traverseForFurtherDiagnostics(tree, mergedReferenceCollection).filter(diagnostic => {
                        return diagnostic.code && typeof diagnostic.code === 'string' && diagnostic.code in diagnosticRules && diagnosticRules[diagnostic.code as keyof typeof diagnosticRules] === true;
                    });
                    this.diagnosticCollection.set(uri, fundamentalDiagnostics.concat(additionalDiagnostics));
                }
            }
        }
    }

    // 
    private parseDocumentContents(contents: string, uri: vscode.Uri, isOpenDocument: boolean, diagnoseProblems: boolean, isCollectionUpdated: boolean) {
        const uriString = uri.toString();

        let tree: tree.Program;
        try {
            tree = parse(contents);
        } catch (error) {
            let diagnostics: vscode.Diagnostic[] | undefined;
            if (error instanceof SyntaxError) {
                if (diagnoseProblems) {
                    diagnostics = [new vscode.Diagnostic(lang.convertRange(error.location), error.message, vscode.DiagnosticSeverity.Error)];
                    this.diagnosticCollection.set(uri, diagnostics);
                }
            } else {
                console.log('Unknown error in sytax parsing', error);
                if (diagnoseProblems) {
                    diagnostics = [new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), 'Unknown error in sytax parsing', vscode.DiagnosticSeverity.Error)];
                    this.diagnosticCollection.set(uri, diagnostics);
                }
            }
            // update with an empty object.
            this.referenceCollection.set(uriString, {});
            // this.updateCompletionItemsForUriString(uriString);
            return { tree: undefined, diagnostics, };
        }
        const diagnosticRules = diagnoseProblems ? vscode.workspace.getConfiguration('spec-command.problems', uri).get('rules', lang.defaultDiagnosticRules) : undefined;
        const [refBook, symbols, traverserDiagnostics] = traverseWholly(tree, diagnosticRules);
        let diagnostics: vscode.Diagnostic[] | undefined;

        if (isOpenDocument) {
            this.treeCollection.set(uriString, tree);
            this.symbolCollection.set(uriString, symbols);
        }
        this.referenceCollection.set(uriString, refBook);
        this.updateCompletionItemsForUriString(uriString);


        if (diagnoseProblems) {
            const parserDiagnostics = tree.problems.map(problem => new vscode.Diagnostic(lang.convertRange(problem.loc), problem.message, problem.severity));
            diagnostics = parserDiagnostics.concat(traverserDiagnostics);

            if (isCollectionUpdated && diagnosticRules && (diagnosticRules['no-undeclared-variable'] === true || diagnosticRules['no-undeclared-macro-argument'] === true)) {
                // This assumes the database of the builtin controller has been loaded.
                const mergedReferenceCollection = new Map([...this.referenceCollection.entries(), ...this.builtInController.referenceCollection.entries()]);
                const additionalDiagnostics = traverseForFurtherDiagnostics(tree, mergedReferenceCollection).filter(diagnostic => {
                    return diagnostic.code && typeof diagnostic.code === 'string' && diagnostic.code in diagnosticRules && diagnosticRules[diagnostic.code as keyof typeof diagnosticRules] === true;
                });
                diagnostics = diagnostics.concat(additionalDiagnostics);
            }
            this.diagnosticCollection.set(uri, diagnostics);
        }

        return { tree, diagnostics, };
    }

    /**
     * Required implementation of vscode.CompletionItemProvider, overriding the super class.
     */
    public override provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.ProviderResult<vscode.CompletionList<lang.CompletionItem> | lang.CompletionItem[]> {
        if (token.isCancellationRequested) { return; }

        const tree = this.treeCollection.get(document.uri.toString());
        if (tree) {
            const refBook = traversePartially(tree, position);
            this.referenceCollection.set(lang.ACTIVE_FILE_URI, refBook);
            this.updateCompletionItemsForUriString(lang.ACTIVE_FILE_URI);
        }
        return super.provideCompletionItems(document, position, token, context);
    }

    /**
     * Required implementation of vscode.HoverProvider, overriding the super class.
     */
    public override provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Hover> {
        if (token.isCancellationRequested) { return; }

        const tree = this.treeCollection.get(document.uri.toString());
        if (tree) {
            const refBook = traversePartially(tree, position);
            this.referenceCollection.set(lang.ACTIVE_FILE_URI, refBook);
        }
        return super.provideHover(document, position, token);
    }

    /**
     * Required implementation of vscode.DefinitionProvider.
     */
    public provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Definition | vscode.DefinitionLink[]> {
        if (token.isCancellationRequested) { return; }

        const range = document.getWordRangeAtPosition(position);
        if (range === undefined) { return; }

        const selectorName = document.getText(range);
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(selectorName)) { return; }

        // update the database for local variables for the current cursor position.
        const tree = this.treeCollection.get(document.uri.toString());
        if (tree) {
            const refBook = traversePartially(tree, position);
            this.referenceCollection.set(lang.ACTIVE_FILE_URI, refBook);
        }

        // seek the identifier
        const locations: vscode.Location[] = [];
        for (const [uriString, refBook] of this.referenceCollection.entries()) {
            const uri = (uriString === lang.ACTIVE_FILE_URI) ? document.uri : vscode.Uri.parse(uriString);

            // scan all types of symbols in the database of the respective files.
            for (const refSheet of Object.values(refBook)) {
                const refItem = refSheet.get(selectorName);
                if (refItem && refItem.location) {
                    locations.push(new vscode.Location(uri, lang.convertRange(refItem.location)));
                }
            }
        }
        return locations;
    }

    /**
     * Required implementation of `vscode.DocumentSymbolProvider`.
     */
    public provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.SymbolInformation[] | vscode.DocumentSymbol[]> {
        if (token.isCancellationRequested) { return; }

        return this.symbolCollection.get(document.uri.toString());
    }

    /**
     * Required implementation of `vscode.WorkspaceSymbolProvider`.
     * 
     * This function looks for all symbol definitions that matched with `query` from the workspace.
     */
    public provideWorkspaceSymbols(query: string, token: vscode.CancellationToken): vscode.ProviderResult<vscode.SymbolInformation[]> {
        if (token.isCancellationRequested) { return; }

        // exit when the query is not empty and contains characters not allowed in an identifier.
        if (!/^[a-zA-Z0-9_]*$/.test(query)) { return; }

        // create a regular expression that filters symbols from `query`
        // e.g., 'abc' => /a.*b.*c/i
        // const regExp = new RegExp(query.replace(/(?=[_A-Z])/g, '.*'), 'i');
        const regExp = new RegExp(query.split('').join('.*'), 'i');

        // seek the identifier
        const symbols: vscode.SymbolInformation[] = [];
        for (const [uriString, refBook] of this.referenceCollection.entries()) {
            // skip storage for local variables
            if (uriString === lang.ACTIVE_FILE_URI) { continue; }

            const uri = vscode.Uri.parse(uriString);

            // find all items from each storage.
            for (const [category, refSheet] of Object.entries(refBook)) {
                const symbolKind = lang.referenceCategoryMetadata[category as keyof typeof refBook].symbolKind;
                for (const [identifier, refItem] of refSheet.entries()) {
                    if ((query.length === 0 || regExp.test(identifier)) && refItem.location) {
                        const name = (category === 'function') ? identifier + '()' : identifier;
                        const location = new vscode.Location(uri, lang.convertRange(refItem.location));
                        symbols.push(new vscode.SymbolInformation(name, symbolKind, '', location));
                    }
                }
            }
        }
        return symbols;
    }

    /**
     * Required implementation of `vscode.DocumentDropEditProvider`.
     * 
     * This function is called when a file is dropped into the editor.
     * This function returns a path string surrrounded by `qdofile()` function.
     */
    public provideDocumentDropEdits(document: vscode.TextDocument, _position: vscode.Position, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): vscode.ProviderResult<vscode.DocumentDropEdit> {
        // The value for 'text/uri-list' key in `dataTransfer` is a string of file list separated by '\r\n'.
        const uriList = dataTransfer.get('text/uri-list');
        if (uriList && typeof uriList.value === 'string') {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);

            return new vscode.DocumentDropEdit(uriList.value.split('\r\n').map(
                uriString => {
                    // Append prefix for relative path, if specified in the configuration.
                    const path = vscode.Uri.parse(uriString).path;
                    let path2: string;
                    if (workspaceFolder && ((path2 = vscode.workspace.asRelativePath(path, false)) !== path)) {
                        path2 = vscode.workspace.getConfiguration('spec-command.terminal', workspaceFolder).get<string>('filePathPrefix', '') + path2;
                    } else {
                        path2 = path;
                    }
                    return `qdofile("${path2}")\n`;
                }
            ).join(''));
        }
    }

    /**
     * required implementation of vscode.TextDocumentContentProvider
     */
    public provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<string> {
        if (token.isCancellationRequested) { return; }

        if (lang.AST_URI === uri.with({ query: '' }).toString()) {
            const docUri = vscode.Uri.parse(uri.query);
            const editor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === docUri.toString());
            if (editor) {
                try {
                    const tree = parse(editor.document.getText());
                    // const content = JSON.stringify(tree, null, 2);
                    return JSON.stringify(tree, (key, value) => { return key === 'loc' ? undefined : value; }, 2);
                } catch (error) {
                    if (error instanceof SyntaxError) {
                        vscode.window.showErrorMessage('Failed to parse the editor contents.');
                    } else {
                        vscode.window.showErrorMessage('Unknown error.');
                    }
                }
            }
        }
    }
}
