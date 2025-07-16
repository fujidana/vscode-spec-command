import * as vscode from 'vscode';
import * as lang from './language';
import { Controller } from './controller';
import { BuiltInController } from './builtInController';
import { SyntaxError, parse } from './parser';
import { traversePartially, traverseWholly, traverseForFurtherDiagnostics } from './traverser';
import type * as tree from './tree';


/**
 * Get a set of the URIs of supported files from workspaces.
 * 
 * @returns a promise of a set of URI strings.
 */
async function findFilesInWorkspaces() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const uriStringSet = new Set<string>();

    if (workspaceFolders) {
        for (const workspaceFolder of workspaceFolders) {
            // Refer to `files.associations` configuration property.
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
            const excludePatterns = vscode.workspace.getConfiguration('spec-command.workspace', workspaceFolder).get<string[]>('exclude', []);
            for (const excludePattern of excludePatterns) {
                const excludeUris = await vscode.workspace.findFiles(new vscode.RelativePattern(workspaceFolder, excludePattern));
                // It seems `Set.prototype.difference()` is not available at the moment.
                for (const excludeUri of excludeUris) {
                    uriStringSet.delete(excludeUri.toString());
                }
            }
        }
    }
    return uriStringSet;
}

type DocumentUpdateQuery = { type: 'Document', document: vscode.TextDocument };
type FileUpdateQuery = { type: 'File', uri: vscode.Uri, diagnose: boolean };

/**
 * A controller subclass that handles files and documents in the current workspace.
 */
export class FileController extends Controller<lang.FileUpdateSession> implements vscode.DefinitionProvider, vscode.DocumentSymbolProvider, vscode.WorkspaceSymbolProvider, vscode.DocumentDropEditProvider, vscode.TextDocumentContentProvider {

    private readonly diagnosticCollection: vscode.DiagnosticCollection;
    private readonly builtInController: BuiltInController;

    constructor(context: vscode.ExtensionContext, builtInController: BuiltInController) {
        super(context);
        this.builtInController = builtInController;

        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('spec-command');

        const showWorkspaceSymbolsJsonCommandHandler = async () => {
            await this.refreshCollections();

            const categories = ['constant', 'variable', 'array', 'macro', 'function'] as const;
            const obj: { [K in typeof categories[number]]: Required<lang.ReferenceBookLike>[K] } = { variable: {}, constant: {}, array: {}, macro: {}, function: {}, };;
            // const obj: Record<typeof categories[number], Record<string, lang.ReferenceItem>> = { variable: {}, constant: {}, array: {}, macro: {}, function: {}, };
            for (const [uriString, session] of this.updateSessionMap.entries()) {
                const refBook = (await session.promise)?.refBook;
                if (refBook === undefined) { continue; }

                // local variables are not exported.
                if (uriString === lang.ACTIVE_FILE_URI) { continue; }

                const refBookLike = lang.categorizeRefBook(refBook, categories);
                for (const [category, refSheet] of Object.entries(refBookLike)) {
                    const category2 = category as keyof typeof refBookLike;
                    if (category2 === 'constant' || category2 === 'variable' || category2 === 'array' || category2 === 'macro' || category2 === 'function') {
                        obj[category2] = Object.assign(obj[category2], refSheet);
                    }
                }
            }
            const content = JSON.stringify(obj, (key, value) => key === 'location' || key === 'category' ? undefined : value, 2);
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
                this.runUpdateSessions([{ type: 'Document', document }]);
            }
        };

        /**
         * Event handler invoked when the document is opened.
         * It is also invoked after the user manually changed the language identifier.
         */
        const textDocumentDidOpenListener = (document: vscode.TextDocument) => {
            if (vscode.languages.match(lang.SELECTOR, document) && document.uri.scheme !== 'git') {
                this.runUpdateSessions([{ type: 'Document', document }]);
            }
        };

        /** Event handler invoked when the document is saved. */
        const textDocumentDidSaveListener = (document: vscode.TextDocument) => {
            if (vscode.languages.match(lang.SELECTOR, document) && document.uri.scheme !== 'git') {
                this.runUpdateSessions([{ type: 'Document', document }]);
            }
        };

        /**
         * Event handler invoked when the document is closed.
         * It is also invoked after the user manually changed the language identifier.
         */
        const textDocumentDidCloseListener = async (document: vscode.TextDocument) => {
            if (vscode.languages.match(lang.SELECTOR, document)) {
                const uriString = document.uri.toString();

                // Check whether the file is in a workspace folder.
                const filesInWorkspaces = await findFilesInWorkspaces();
                if (filesInWorkspaces.has(uriString)) {
                    // If file also exists in a workspace folder, delete tree and symbols.
                    const parsedData = await this.updateSessionMap.get(uriString)?.promise;
                    if (parsedData) {
                        parsedData.tree = undefined;
                        parsedData.symbols = undefined;
                    }

                    // Clear diagnostics if setting for workspace.diagnoseProblem is false. 
                    const diagnoseInWorkspace = vscode.workspace.getConfiguration('spec-command.workspace', document).get<boolean>('diagnoseProblems', false);
                    if (!diagnoseInWorkspace) {
                        this.diagnosticCollection.delete(document.uri);
                    }
                } else {
                    // If file does not exist in a workspace folder, clear all.
                    this.updateSessionMap.delete(uriString);
                    this.diagnosticCollection.delete(document.uri);
                }
            }
        };

        // const activeTextEditorDidChangeListener = (editor: vscode.TextEditor | undefined) => { };

        // const fileDidCreateListener = async (event: vscode.FileCreateEvent) => { };

        /** Event handler invoked after files are renamed. */
        const fileDidRenameListener = async (event: vscode.FileRenameEvent) => {
            const filesInWorkspaces = await findFilesInWorkspaces();
            let oldUriStrings: string[] | undefined;
            let newUriStrings: string[] | undefined;

            for (const { oldUri, newUri } of event.files) {
                const stat = await vscode.workspace.fs.stat(newUri);
                if (stat.type === vscode.FileType.File) {
                    oldUriStrings = [oldUri.toString()];
                    if (filesInWorkspaces.has(newUri.toString())) {
                        newUriStrings = [newUri.toString()];
                    }
                } else if (stat.type === vscode.FileType.Directory) {
                    const oldDir = oldUri.toString() + '/';
                    oldUriStrings = [...this.updateSessionMap.keys()].filter(uriString => uriString.startsWith(oldDir));
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
                        let oldUriStrings: string[] | undefined;
                        if (stat.type === vscode.FileType.File) {
                            oldUriStrings = [oldUri.toString()];
                        } else if (stat.type === vscode.FileType.Directory) {
                            const oldDir = oldUri.toString() + '/';
                            oldUriStrings = [...this.updateSessionMap.keys()].filter(uriString => uriString.startsWith(oldDir));
                        }
                        this.reflectFileOperationInCollections(oldUriStrings);
                    }
                );
                event.waitUntil(promise);
            }
        };

        /** Event handler invoked when the configuration is changed. */
        const configurationDidChangeListener = (event: vscode.ConfigurationChangeEvent) => {
            if (event.affectsConfiguration('spec-command.workspace') ||
                event.affectsConfiguration('files.associations') ||
                event.affectsConfiguration('files.encoding') ||
                event.affectsConfiguration('spec-command.problems.rules')
            ) {
                this.refreshCollections();
            }
        };

        /** Event handler invoked when the workspace folders are changed. */
        const workspaceFoldersDidChangeListener = (event: vscode.WorkspaceFoldersChangeEvent) => {
            this.refreshCollections();
        };

        // Asynchronously scan files and refresh the collection.
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
     * @param oldUriStrings An iterable collection of file URIs of which metadata will be removed.
     * @param newUriStrings An iterable collection of file URIs of which metadata will be created. The file should be filtered beforehand.
     */
    private reflectFileOperationInCollections(oldUriStrings?: Iterable<string>, newUriStrings?: Iterable<string>) {
        // Clear data for old URIs.
        if (oldUriStrings) {
            for (const oldUriString of oldUriStrings) {
                this.updateSessionMap.delete(oldUriString);
                this.diagnosticCollection.delete(vscode.Uri.parse(oldUriString));
            }
        }

        // Parse files and store reference information for new URIs.
        // Do nothing for opened document files because they are handled by
        // `onDidOpenTextDocument` and `onDidCloseTextDocument` events.
        if (newUriStrings) {
            this.runMultipleUpdateSessions(newUriStrings, false);
        }
    }

    /**
     * Refresh the database by scanning files open in editor and other files in workspace folders.
     */
    private async refreshCollections() {
        // Clear caches.
        this.updateSessionMap.clear();
        this.diagnosticCollection.clear();

        // Parse files in workspaces.
        return this.runMultipleUpdateSessions(await findFilesInWorkspaces(), true);
    }

    /**
     * Subroutine that collects information for code navigation/editing.
     * Cancellation token is integrated.
     */
    private async runUpdateSessions(queries: (FileUpdateQuery | DocumentUpdateQuery)[]) {
        const updatedSessionMap: Map<string, { session: lang.FileUpdateSession, diagnosticRules: lang.DiagnosticRules | undefined }> = new Map();

        // Run workspace-independent analysis (IOW, analysis that does not use symbols defined in other files).
        for (const query of queries) {
            let uri: vscode.Uri;
            let diagnose: boolean;
            if (query.type === 'Document') {
                uri = query.document.uri;
                diagnose = true;
            } else {
                uri = query.uri;
                diagnose = query.diagnose;
            }
            const uriString = uri.toString();
            const diagnosticRules = diagnose ? vscode.workspace.getConfiguration('spec-command.problems', uri).get('rules', lang.defaultDiagnosticRules) : undefined;

            // If the previous session for a file is still runnning, cancel it.
            this.updateSessionMap.get(uriString)?.tokenSource?.cancel();

            // Create a new update session and start to analyze.
            const tokenSource = new vscode.CancellationTokenSource();
            const promise = (query.type === 'Document') ?
                Promise.resolve().then(() => analyzeDocumentContent(query.document.getText(), diagnosticRules, true, tokenSource.token)) :
                analyzeContentOfUri(query.uri, diagnosticRules, false, tokenSource.token);
            const session: lang.FileUpdateSession = { promise, tokenSource };
            // Attach a callback that will clean the cancellation token when update is finished.
            session.promise.finally(() => {
                tokenSource.dispose();
                session.tokenSource = undefined;
            });
            this.updateSessionMap.set(uriString, session);
            updatedSessionMap.set(uriString, { session, diagnosticRules });
        }

        // Run analysis that uses symbols in other files.
        // First, wait for completion of workspace-independent analysis.
        // let settledResults = await Promise.allSettled([...updatedSessionMap.values()].map(session => session.promise));
        // settledResults = settledResults.filter(settledResult => settledResult.status === 'fulfilled');
        const referenceBooks = await this.mergedReferenceBooks();

        for (const [uriString, container] of updatedSessionMap) {
            const uri = vscode.Uri.parse(uriString);
            const parsedData = await container.session.promise;
            if (parsedData) {
                const diagnostics = analyzeDocumentContent2(parsedData, container.diagnosticRules, referenceBooks, container.session.tokenSource?.token);
                this.diagnosticCollection.set(uri, diagnostics);
            } else {
                this.diagnosticCollection.set(uri, []);
            }
        }
    }

    /**
     * Subroutine to parse the contents of multiple files specified by URIs.
     */
    private runMultipleUpdateSessions(targetUriStrings: Iterable<string>, includeFilesInEditor: boolean) {
        const uriStringsNotInEditor: string[] = [...targetUriStrings];
        const queries: (FileUpdateQuery | DocumentUpdateQuery)[] = [];

        for (const document of vscode.workspace.textDocuments) {
            const uriString = document.uri.toString();
            if (vscode.languages.match(lang.SELECTOR, document) && document.uri.scheme !== 'git') {
                const index = uriStringsNotInEditor.indexOf(uriString);
                if (index !== -1) {
                    if (includeFilesInEditor) {
                        queries.push({ type: 'Document', document });
                    }
                    uriStringsNotInEditor.splice(index, 1);
                }
            }
        }

        for (const uriString of uriStringsNotInEditor) {
            const uri = vscode.Uri.parse(uriString);
            const diagnose = vscode.workspace.getConfiguration('spec-command.workspace', uri).get<boolean>('diagnoseProblems', false);
            // const diagnosticRules = diagnose ? vscode.workspace.getConfiguration('spec-command.problems', uri).get('rules', lang.defaultDiagnosticRules) : undefined;
            queries.push({ type: 'File', uri, diagnose });
        }

        return this.runUpdateSessions(queries);
    }

    /**
     * Asynchronously update position-sensitive local symbol database.
     * @param document Text Document
     * @param position Position
     * @returns Thenable that resolves to a session container that contains parsed data.
     */
    private runLocalUpdateSession(document: vscode.TextDocument, position: vscode.Position) {
        // Update the database for local variables for the current cursor position.
        const session = this.updateSessionMap.get(document.uri.toString());
        if (session) {
            const promise = session.promise.then(
                parsedData => {
                    if (parsedData?.tree) {
                        return { refBook: traversePartially(parsedData.tree, position) };
                    };
                }
            );
            this.updateSessionMap.set(lang.ACTIVE_FILE_URI, { promise, tokenSource: undefined });
            return promise;
        } else {
            this.updateSessionMap.delete(lang.ACTIVE_FILE_URI);
            return undefined;
        }
    }

    /**
     * Asynchronously obtain an array of reference books of both built-in
     * symbols and those defined in files.     
     * @returns Thenable that resolves to an array of reference books.
     */
    private async mergedReferenceBooks() {
        const refBooks: lang.ReferenceBook[] = [];
        const promises = [...this.updateSessionMap.values(), ...this.builtInController.updateSessionMap.values()].map(session => session.promise);

        const settledResults = await Promise.allSettled(promises);
        for (const settledResult of settledResults) {
            if (settledResult.status === 'fulfilled' && settledResult.value) {
                refBooks.push(settledResult.value.refBook);
            }
        }
        return refBooks;
    }

    /**
     * Required implementation of vscode.CompletionItemProvider, overriding the super class.
     */
    public override async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): Promise<vscode.CompletionList<lang.CompletionItem> | lang.CompletionItem[] | undefined> {
        if (token.isCancellationRequested) { return; }

        // Update the database for local variables for the current cursor position.
        this.runLocalUpdateSession(document, position);

        return super.provideCompletionItems(document, position, token, context);
    }

    /**
     * Required implementation of vscode.HoverProvider, overriding the super class.
     */
    public override async provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Hover | undefined> {
        if (token.isCancellationRequested) { return; }

        // Update the database for local variables for the current cursor position.
        this.runLocalUpdateSession(document, position);

        return super.provideHover(document, position, token);
    }

    /**
     * Required implementation of vscode.DefinitionProvider.
     */
    public async provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Definition | vscode.DefinitionLink[] | undefined> {
        if (token.isCancellationRequested) { return; }

        const range = document.getWordRangeAtPosition(position);
        if (range === undefined) { return; }

        const selectorName = document.getText(range);
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(selectorName)) { return; }

        // Update the database for local variables for the current cursor position.
        this.runLocalUpdateSession(document, position);

        // Seek the identifier.
        const locations: vscode.Location[] = [];
        for (const [uriString, session] of this.updateSessionMap.entries()) {
            const uri = (uriString === lang.ACTIVE_FILE_URI) ? document.uri : vscode.Uri.parse(uriString);

            // scan all types of symbols in the database of the respective files.
            const refItem = (await session.promise)?.refBook.get(selectorName);
            if (refItem && refItem.location) {
                locations.push(new vscode.Location(uri, lang.convertRange(refItem.location)));
            }
        }
        return locations;
    }

    /**
     * Required implementation of `vscode.DocumentSymbolProvider`.
     */
    public async provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.SymbolInformation[] | vscode.DocumentSymbol[] | undefined> {
        if (token.isCancellationRequested) { return; }

        return (await this.updateSessionMap.get(document.uri.toString())?.promise)?.symbols;
    }

    /**
     * Required implementation of `vscode.WorkspaceSymbolProvider`.
     * 
     * This function looks for all symbol definitions that matched with `query` from the workspace.
     */
    public async provideWorkspaceSymbols(query: string, token: vscode.CancellationToken): Promise<vscode.SymbolInformation[] | undefined> {
        if (token.isCancellationRequested) { return; }

        // Quit when the query is not empty and contains characters not allowed in an identifier.
        if (!/^[a-zA-Z0-9_]*$/.test(query)) { return; }

        // Create a regular expression that filters symbols from `query`.
        // e.g., 'abc' => /a.*b.*c/i
        // const regExp = new RegExp(query.replace(/(?=[_A-Z])/g, '.*'), 'i');
        const regExp = new RegExp(query.split('').join('.*'), 'i');

        // Collect symbols defined in workspaces.
        const symbols: vscode.SymbolInformation[] = [];
        for (const [uriString, session] of this.updateSessionMap.entries()) {
            // Skip storage for local variables
            if (uriString === lang.ACTIVE_FILE_URI) { continue; }

            const uri = vscode.Uri.parse(uriString);
            const refBook = (await session.promise)?.refBook;

            // Quit if cancelled and skip if symbol is not found in the file.
            if (token.isCancellationRequested) { return; }
            if (refBook === undefined) { continue; }

            // Find all items from each storage.
            for (const [identifier, refItem] of refBook.entries()) {
                if ((query.length === 0 || regExp.test(identifier)) && refItem.location) {
                    const name = (refItem.category === 'function') ? identifier + '()' : identifier;
                    const location = new vscode.Location(uri, lang.convertRange(refItem.location));
                    const symbolKind = lang.referenceCategoryMetadata[refItem.category].symbolKind;
                    symbols.push(new vscode.SymbolInformation(name, symbolKind, '', location));
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

async function analyzeContentOfUri(uri: vscode.Uri, diagnosticRules: lang.DiagnosticRules | undefined, isInEditor: boolean, token: vscode.CancellationToken): Promise<lang.ParsedFileData | undefined> {
    const uint8Array = await vscode.workspace.fs.readFile(uri);
    const content = await vscode.workspace.decode(uint8Array, { uri });
    return analyzeDocumentContent(content, diagnosticRules, isInEditor, token);
}

function analyzeDocumentContent(content: string, diagnosticRules: lang.DiagnosticRules | undefined, isInEditor: boolean, token: vscode.CancellationToken): lang.ParsedFileData | undefined {
    if (token.isCancellationRequested) { return undefined; }

    let tree: tree.Program;
    let diagnostics: vscode.Diagnostic[] | undefined;
    try {
        tree = parse(content);
    } catch (error) {
        if (error instanceof SyntaxError) {
            if (diagnosticRules) {
                diagnostics = [new vscode.Diagnostic(lang.convertRange(error.location), error.message, vscode.DiagnosticSeverity.Error)];
            }
        } else {
            console.log('Unknown error in sytax parsing', error);
            if (diagnosticRules) {
                diagnostics = [new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), 'Unknown error in parsing', vscode.DiagnosticSeverity.Error)];
            }
        }
        return { refBook: new Map(), diagnostics: diagnostics };
    }

    if (token.isCancellationRequested) { return undefined; }

    const [refBook, symbols, traverserDiagnostics] = traverseWholly(tree, diagnosticRules);

    if (diagnosticRules) {
        const parserDiagnostics = tree.problems.map(problem => new vscode.Diagnostic(lang.convertRange(problem.loc), problem.message, problem.severity));
        diagnostics = parserDiagnostics.concat(traverserDiagnostics);
    }

    if (isInEditor) {
        return { refBook, tree, symbols, diagnostics };
    } else {
        return { refBook, diagnostics };
    }
}

function analyzeDocumentContent2(parsedData: lang.ParsedFileData, diagnosticRules: lang.DiagnosticRules | undefined, rererenceBooks: readonly lang.ReferenceBook[], token: vscode.CancellationToken | undefined) {
    if (token && token.isCancellationRequested) { return undefined; }

    if (parsedData.tree && diagnosticRules) {
        const diagnostics = traverseForFurtherDiagnostics(parsedData.tree, rererenceBooks).filter(diagnostic => {
            return diagnostic.code && typeof diagnostic.code === 'string' && diagnostic.code in diagnosticRules && diagnosticRules[diagnostic.code as keyof typeof diagnosticRules] === true;
        });
        parsedData.diagnostics = (parsedData.diagnostics ?? []).concat(diagnostics);
    }
    return parsedData.diagnostics;
}
