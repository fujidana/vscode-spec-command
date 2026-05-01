import * as vscode from 'vscode';
import * as lang from './language';
import { Controller } from './controller';
import { SyntaxError, parse } from './parser';
import { traversePartially, traverseWholly, traverseForFurtherDiagnostics } from './traverser';
import type * as tree from './tree';


const AST_URI = 'spec-command://file/ast.json';


/**
 * Get a set of the URIs of supported files from workspaces.
 * 
 * @returns Thenable that resolves to a set of URI strings.
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
    public dictionaryUpdateSessionMap: Map<string, lang.UpdateSession> | undefined;

    constructor(context: vscode.ExtensionContext) {
        super(context);

        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('spec-command');

        const inspectSyntaxTreeCommandHandler = () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'spec-command') {
                const uri = vscode.Uri.parse(AST_URI).with({
                    query: editor.document.uri.toString(),
                    fragment: editor.document.version.toString(),
                });
                vscode.window.showTextDocument(uri, { preview: false });
            }
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
                    const parserResult = await this.updateSessionMap.get(uriString)?.promise;
                    if (parserResult) {
                        parserResult.tree = undefined;
                        parserResult.symbols = undefined;
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
            vscode.commands.registerCommand('spec-command.inspectSyntaxTree', inspectSyntaxTreeCommandHandler),

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
        // Clear data.
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
            const parserResult = await container.session.promise;
            if (parserResult) {
                const diagnostics = analyzeDocumentContent2(parserResult, container.diagnosticRules, referenceBooks, container.session.tokenSource?.token);
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
            if (vscode.languages.match(lang.SELECTOR, document) && document.uri.scheme !== 'git') {
                const index = uriStringsNotInEditor.indexOf(document.uri.toString());
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
                parserResult => {
                    if (parserResult?.tree) {
                        return { refBook: traversePartially(parserResult.tree, position) };
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
        // dictionaryUpdateSessionMap is set after the constructor is called, so it is safe to use the non-null assertion operator.
        const promises = [...this.updateSessionMap.values(), ...this.dictionaryUpdateSessionMap!.values()].map(session => session.promise);

        const settledResults = await Promise.allSettled(promises);
        for (const settledResult of settledResults) {
            if (settledResult.status === 'fulfilled' && settledResult.value) {
                refBooks.push(settledResult.value.refBook);
            }
        }
        return refBooks;
    }

    // Override the method in the base class to provide custom descriptions for completion items.
    // For symbols defined in a file in the workspace, it returns the relative path.
    protected getCompletionItemLabelDescription(uriString: string): string | undefined {
        if (uriString === lang.ACTIVE_FILE_URI) {
            return 'local';
        } else {
            return vscode.workspace.asRelativePath(vscode.Uri.parse(uriString));
        }
    }

    // Override the method in the base class to provide short text on hover and resolved completion items.
    protected getSignatureComment(categoryLabel: string, _uriString: string): string {
        return `user-defined ${categoryLabel}`;
    }

    // Required implementation of vscode.CompletionItemProvider, overriding the super class.
    public override async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): Promise<vscode.CompletionList<lang.CompletionItem> | lang.CompletionItem[] | undefined> {
        if (token.isCancellationRequested) { return; }

        // Update the database for local variables for the current cursor position.
        this.runLocalUpdateSession(document, position);

        return super.provideCompletionItems(document, position, token, context);
    }

    // Required implementation of vscode.HoverProvider, overriding the super class.
    public override async provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Hover | undefined> {
        if (token.isCancellationRequested) { return; }

        // Update the database for local variables for the current cursor position.
        this.runLocalUpdateSession(document, position);

        return super.provideHover(document, position, token);
    }

    // Required implementation of vscode.DefinitionProvider.
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

            // Scan all types of symbols in the database of the respective files.
            const refItem = (await session.promise)?.refBook.get(selectorName);
            if (token.isCancellationRequested) { return; }

            if (refItem && refItem.location) {
                locations.push(new vscode.Location(uri, lang.convertRange(refItem.location)));
            }
        }
        return locations;
    }

    // Required implementation of `vscode.DocumentSymbolProvider`.
    public async provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.SymbolInformation[] | vscode.DocumentSymbol[] | undefined> {
        if (token.isCancellationRequested) { return; }

        return (await this.updateSessionMap.get(document.uri.toString())?.promise)?.symbols;
    }

    // Required implementation of `vscode.WorkspaceSymbolProvider`.
    // This function looks for all symbol definitions that matched with `query` from the workspace.
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
            // Skip storage for local variables.
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
                    const symbolKind = lang.getSymbolKindForCategory(refItem.category);
                    symbols.push(new vscode.SymbolInformation(name, symbolKind, '', location));
                }
            }
        }
        return symbols;
    }

    // Required implementation of `vscode.DocumentDropEditProvider`.
    // This function is called when a file is dropped into the editor.
    // This function returns a path string surrrounded by `qdofile()` function.
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
                        // path2 = vscode.workspace.getConfiguration('spec-command.terminal', workspaceFolder).get<string>('filePathPrefix', '') + path2;
                    } else {
                        path2 = path;
                    }
                    return `qdofile("${path2}")\n`;
                }
            ).join(''));
        }
    }

    // Required implementation of vscode.TextDocumentContentProvider.
    public provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<string> {
        if (token.isCancellationRequested) { return; }

        // Responds to the `"spec-command.inspectSyntaxTree"` command and shows the syntax tree of the selected document in JSON format.
        if (AST_URI === uri.with({ query: '', fragment: '' }).toString()) {
            const docUri = vscode.Uri.parse(uri.query);
            const editor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === docUri.toString());
            if (editor) {
                try {
                    const tree = parse(editor.document.getText());
                    // const content = JSON.stringify(tree, null, 2);
                    return JSON.stringify(tree, (key, value) => { return key === 'loc' ? undefined : value; }, 2);
                } catch (error) {
                    if (error instanceof SyntaxError) {
                        vscode.window.showErrorMessage(vscode.l10n.t('Syntax error in parsing: {0}', error.message));
                    } else if (error instanceof Error) {
                        vscode.window.showErrorMessage(vscode.l10n.t('Error in parsing: {0}', error.message));
                    } else {
                        vscode.window.showErrorMessage(vscode.l10n.t('Unknown error in parsing: {0}', String(error)));
                    }
                }
            }
        }
    }
}

async function analyzeContentOfUri(uri: vscode.Uri, diagnosticRules: lang.DiagnosticRules | undefined, isInEditor: boolean, token: vscode.CancellationToken): Promise<lang.FileParserResult | undefined> {
    const uint8Array = await vscode.workspace.fs.readFile(uri);
    const content = await vscode.workspace.decode(uint8Array, { uri });
    return analyzeDocumentContent(content, diagnosticRules, isInEditor, token);
}

function analyzeDocumentContent(content: string, diagnosticRules: lang.DiagnosticRules | undefined, isInEditor: boolean, token: vscode.CancellationToken): lang.FileParserResult | undefined {
    if (token.isCancellationRequested) { return undefined; }

    let tree: tree.Program;
    let diagnostics: vscode.Diagnostic[] | undefined;
    try {
        tree = parse(content);
    } catch (error) {
        if (diagnosticRules) {
            if (error instanceof SyntaxError) {
                diagnostics = [new vscode.Diagnostic(lang.convertRange(error.location), error.message)];
                diagnostics[0].code = 'syntax-error';
            } else if (error instanceof Error) {
                diagnostics = [new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), vscode.l10n.t('Error in parsing: {0}', error.message))];
            } else {
                diagnostics = [new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), vscode.l10n.t('Unknown error in parsing: {0}', String(error)))];
            }
        }
        return { refBook: new Map(), diagnostics };
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

function analyzeDocumentContent2(parserResult: lang.FileParserResult, diagnosticRules: lang.DiagnosticRules | undefined, referenceBooks: readonly lang.ReferenceBook[], token: vscode.CancellationToken | undefined) {
    if (token && token.isCancellationRequested) { return undefined; }

    if (parserResult.tree && diagnosticRules) {
        const diagnostics = traverseForFurtherDiagnostics(parserResult.tree, referenceBooks).filter(diagnostic => {
            return diagnostic.code && typeof diagnostic.code === 'string' && diagnostic.code in diagnosticRules && diagnosticRules[diagnostic.code as keyof typeof diagnosticRules] === true;
        });
        parserResult.diagnostics = (parserResult.diagnostics ?? []).concat(diagnostics);
    }
    return parserResult.diagnostics;
}
