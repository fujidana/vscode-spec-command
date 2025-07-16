import * as vscode from 'vscode';
import * as lang from "./language";
import { Controller } from "./controller";

const SNIPPET_TEMPLATES: Record<string, string> = {
    mv: 'mv ${1%MOT} ${2:pos} # absolute-position motor move',
    mvr: 'mvr ${1%MOT} ${2:pos} # relative-position motor move',
    umv: 'umv ${1%MOT} ${2:pos} # absolute-position motor move (live update)',
    umvr: 'umvr ${1%MOT} ${2:pos} # relative-position motor move (live update)',
    ascan: 'ascan ${1%MOT1} ${2:begin} ${3:end} ${4:steps} ${5:sec} # single-motor absolute-position scan',
    dscan: 'dscan ${1%MOT1} ${2:begin} ${3:end} ${4:steps} ${5:sec} # single-motor relative-position scan',
    a2scan: 'a2scan ${1%MOT1} ${2:begin1} ${3:end1} ${4%MOT2} ${5:begin2} ${6:end2} ${7:steps} ${8:sec} # two-motor absolute-position scan',
    d2scan: 'd2scan ${1%MOT1} ${2:begin1} ${3:end1} ${4%MOT2} ${5:begin2} ${6:end2} ${7:steps} ${8:sec} # two-motor relative-position scan',
    a3scan: 'a3scan ${1%MOT1} ${2:begin1} ${3:end1} ${4%MOT2} ${5:begin2} ${6:end2} ${7%MOT3} ${8:begin3} ${9:end3} ${10:steps} ${11:sec} # single-motor absolute-position scan',
    d3scan: 'd3scan ${1%MOT1} ${2:begin1} ${3:end1} ${4%MOT2} ${5:begin2} ${6:end2} ${7%MOT3} ${8:begin3} ${9:end3} ${10:steps} ${11:sec} # single-motor relative-position scan',
    a4scan: 'a4scan ${1%MOT1} ${2:begin1} ${3:end1} ${4%MOT2} ${5:begin2} ${6:end2} ${7%MOT3} ${8:begin3} ${9:end3} ${10%MOT4} ${11:begin4} ${12:end4} ${13:steps} ${14:sec} # four-motor absolute-position scan',
    d4scan: 'd4scan ${1%MOT1} ${2:begin1} ${3:end1} ${4%MOT2} ${5:begin2} ${6:end2} ${7%MOT3} ${8:begin3} ${9:end3} ${10%MOT4} ${11:begin4} ${12:end4} ${13:steps} ${14:sec} # four-motor relative-position scan',
    a5scan: 'a5scan ${1%MOT1} ${2:begin1} ${3:end1} ${4%MOT2} ${5:begin2} ${6:end2} ${7%MOT3} ${8:begin3} ${9:end3} ${10%MOT4} ${11:begin4} ${12:end4} ${13%MOT5} ${14:begin5} ${15:end5} ${16:steps} ${17:sec} # five-motor absolute-position scan',
    d5scan: 'd5scan ${1%MOT1} ${2:begin1} ${3:end1} ${4%MOT2} ${5:begin2} ${6:end2} ${7%MOT3} ${8:begin3} ${9:end3} ${10%MOT4} ${11:begin4} ${12:end4} ${13%MOT5} ${14:begin5} ${15:end5} ${16:steps} ${17:sec} # five-motor relative-position scan',
    mesh: 'mesh ${1%MOT1} ${2:begin1} ${3:end1} ${4:step1} ${5%MOT2} ${6:begin2} ${7:end2} ${8:steps2} ${9:sec} # nested two-motor absolute-position scan that scanned over a grid of points',
    dmesh: 'dmesh ${1%MOT1} ${2:begin1} ${3:end1} ${4:step1} ${5%MOT2} ${6:begin2} ${7:end2} ${8:steps2} ${9:sec} # nested two-motor relative-position scan that scanned over a grid of points',
};

/**
 * A controller subclass that manages built-in symbols and motor mnemonics.
 */
export class BuiltInController extends Controller<lang.UpdateSession> implements vscode.TextDocumentContentProvider {
    private activeWorkspaceFolder: vscode.WorkspaceFolder | undefined;

    constructor(context: vscode.ExtensionContext) {
        super(context);

        // Load built-in symbol database from the JSON file.
        const builtInRefFileUri = vscode.Uri.joinPath(context.extensionUri, 'syntaxes', 'specCommand.builtIns.json');
        const promise = loadReferenceBook(builtInRefFileUri);
        this.updateSessionMap.set(lang.BUILTIN_URI, { promise });

        // Load external symbol database from the JSON file.
        const externalRefFileUri = getExternalRefBookUri();
        if (externalRefFileUri) {
            const promise = loadReferenceBook(externalRefFileUri).then(
                undefined, _reason => {
                    vscode.window.showErrorMessage(`Failed to load external symbols: ${externalRefFileUri.toString()}`, 'OK', 'Open Settings').then(
                        item => {
                            // Do not return a value so that the return value (promise-like object) of the function
                            // does not wait for an action against the dialog.
                            if (item === 'Open Settings') {
                                vscode.commands.executeCommand('workbench.action.openSettings', 'spec-command.suggest.symbolFile');
                            }
                        }
                    );
                    return undefined;
                }
            );
            this.updateSessionMap.set(lang.EXTERNAL_URI, { promise });
        }

        // Initialize reference database for motors, counters and snippets.
        const editor = vscode.window.activeTextEditor;
        this.activeWorkspaceFolder = editor ? vscode.workspace.getWorkspaceFolder(editor.document.uri) : undefined;
        this.updateMnemonicRefBook('motors');
        this.updateMnemonicRefBook('counters');
        this.updateSnippetRefBook();

        /** Event listener for active text editor changes. */
        const activeTextEditorDidChangeListener = (event: vscode.TextEditor | undefined) => {
            const newActiveWorkspaceFolder = event ? vscode.workspace.getWorkspaceFolder(event.document.uri) : undefined;
            if (this.activeWorkspaceFolder !== newActiveWorkspaceFolder) {
                this.activeWorkspaceFolder = newActiveWorkspaceFolder;
                this.updateMnemonicRefBook('motors');
                this.updateMnemonicRefBook('counters');
                this.updateSnippetRefBook();
            }
        };

        /** Event listener for configuration changes. */
        const configurationDidChangeListener = (event: vscode.ConfigurationChangeEvent) => {
            if (event.affectsConfiguration('spec-command.suggest.motors', this.activeWorkspaceFolder)) {
                this.updateMnemonicRefBook('motors');
                this.updateSnippetRefBook();
            }
            if (event.affectsConfiguration('spec-command.suggest.counters', this.activeWorkspaceFolder)) {
                this.updateMnemonicRefBook('counters');
                this.updateSnippetRefBook();
            }
            if (event.affectsConfiguration('spec-command.suggest.codeSnippets', this.activeWorkspaceFolder)) {
                this.updateSnippetRefBook();
            }
            if (event.affectsConfiguration('spec-command.suggest.symbolFile')) {
                const externalRefUri = getExternalRefBookUri();
                if (externalRefUri) {
                    const promise = loadReferenceBook(externalRefUri).then(
                        undefined, _reason => {
                            vscode.window.showErrorMessage(`Failed to load external symbols: ${externalRefUri.toString()}`);
                            return undefined;
                        }
                    );
                    this.updateSessionMap.set(lang.EXTERNAL_URI, { promise });
                } else {
                    this.updateSessionMap.delete(lang.EXTERNAL_URI);
                }
            }
        };

        /** 
         * Command handler fow showing built-in symbols as a virtual document.
         * This function just asks the applicaiton to open a URI and `provideTextDocumentContent`
         * method actually generates the content.
        */
        const showBuiltInSymbolsCommandHandler = async () => {
            const categories = ['constant', 'variable', 'macro', 'function', 'keyword'] as const;
            const quickPickItems = [{ category: 'all', label: '$(references) all' }];
            for (const category of categories) {
                const metadata = lang.referenceCategoryMetadata[category];
                quickPickItems.push({ category: category, label: `$(${metadata.iconIdentifier}) ${metadata.label}` });
            }
            const quickPickItem = await vscode.window.showQuickPick(quickPickItems);
            if (quickPickItem) {
                const uri = vscode.Uri.parse(lang.BUILTIN_URI).with({ query: quickPickItem.category });
                const editor = await vscode.window.showTextDocument(uri, { preview: false });
                const flag = vscode.workspace.getConfiguration('spec-command').get<boolean>('showSymbolsInPreview');
                if (flag) {
                    await vscode.commands.executeCommand('markdown.showPreview');
                    // await vscode.window.showTextDocument(editor.document);
                    // vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                }
            }
        };

        // Register command and event handlers.
        context.subscriptions.push(
            // Register command handlers.
            vscode.commands.registerCommand('spec-command.showBuiltInSymbols', showBuiltInSymbolsCommandHandler),
            // Register providers.
            vscode.workspace.registerTextDocumentContentProvider('spec-command', this),
            // register event handlers
            vscode.window.onDidChangeActiveTextEditor(activeTextEditorDidChangeListener),
            vscode.workspace.onDidChangeConfiguration(configurationDidChangeListener),
        );
    }

    /**
     * Update the reference database for motor or counter mnemonic.
     * Invoked when initialization completed or configuration modified. 
     */
    private updateMnemonicRefBook(kind: 'motors' | 'counters') {
        const uriString = kind === 'motors' ? lang.MOTOR_URI : lang.COUNTER_URI;
        const refBook: lang.ReferenceBook = new Map();

        const record = vscode.workspace.getConfiguration('spec-command.suggest', this.activeWorkspaceFolder).get<Record<string, string>>(kind);
        if (record) {
            const regExp = /^[a-zA-Z_][a-zA-Z0-9_]{0,6}$/;
            for (const [signature, description] of Object.entries(record)) {
                if (regExp.test(signature)) {
                    refBook.set(signature, { signature, description, category: 'enum' });
                }
            }
        }
        this.updateSessionMap.set(uriString, { promise: Promise.resolve({ refBook }) });
    }

    /**
     * Update the reference database for snippets.
     * Invoked when initialization completed or configuration modified. 
     */
    private async updateSnippetRefBook() {
        const refBook: lang.ReferenceBook = new Map();

        const userTemplates = vscode.workspace.getConfiguration('spec-command.suggest', this.activeWorkspaceFolder).get<Record<string, string>>('codeSnippets', {});
        const templates = Object.assign({}, SNIPPET_TEMPLATES, userTemplates);

        const motorRefBook = (await this.updateSessionMap.get(lang.MOTOR_URI)?.promise)?.refBook;
        const counterRefBook = (await this.updateSessionMap.get(lang.COUNTER_URI)?.promise)?.refBook;
        const motorChoiceString = (motorRefBook && motorRefBook.size > 0) ?
            '|' + [...motorRefBook.keys()].join(',') + '|' :
            ':motor$1';
        const counterChoiceString = (counterRefBook && counterRefBook.size > 0) ?
            '|' + [...counterRefBook.keys()].join(',') + '|' :
            ':counter$1';

        // 'mv ${1%MOT} ${2:pos} # motor move' -> Array ["mv ${1%MOT} ${2:pos} # motor move", "mv ${1%MOT} ${2:pos}", "mv", "# motor move", "motor move"]
        const mainRegExp = /^([^#]+?)\s*(?:#\s*(.*))?$/;
        const motorRegExp = /%MOT(\d*)/g;
        const counterRegExp = /%CNT(\d*)/g;
        const placeHolderRegExp = /\${\d+:([^{}]+)}/g;
        const choiceRegExp = /\${\d+\|[^|]+\|}/g;

        for (const [key, value] of Object.entries(templates)) {
            const matches = value.match(mainRegExp);
            if (matches) {
                const signature = matches[1].replace(motorRegExp, ':motor$1').replace(counterRegExp, ':counter$1').replace(placeHolderRegExp, '$1').replace(choiceRegExp, 'choice');
                const snippet = matches[1].replace(motorRegExp, motorChoiceString).replace(counterRegExp, counterChoiceString);
                const description = matches[2];
                refBook.set(key, { signature, description, snippet, category: 'snippet' });
            }
        }
        this.updateSessionMap.set(lang.SNIPPET_URI, { promise: Promise.resolve({ refBook }) });
    }

    /**
     * Required implementation of vscode.TextDocumentContentProvider.
     */
    public async provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): Promise<string | undefined> {
        if (token.isCancellationRequested) { return; }

        const getFormattedStringForItem = (item: { signature: string, description?: string, deprecated?: lang.VersionRange, available?: lang.VersionRange }) => {
            let mdText = `\`${item.signature}\``;
            mdText += item.description ? ` \u2014 ${item.description}\n\n` : '\n\n';
            if (item.available) {
                mdText += lang.getVersionRangeDescription(item.available, 'available') + '\n\n';
            }
            if (item.deprecated) {
                mdText += lang.getVersionRangeDescription(item.deprecated, 'deprecated') + '\n\n';
            }
            return mdText;
        };

        if (lang.BUILTIN_URI === uri.with({ query: '' }).toString()) {
            const refBook = (await this.updateSessionMap.get(lang.BUILTIN_URI)?.promise)?.refBook;

            // Quit if cancelled or symbol is not found in the file.
            if (token.isCancellationRequested) { return; }
            if (refBook === undefined) { return; }

            // Categorize reference items from a flattend map.
            const categories = ['constant', 'variable', 'macro', 'function', 'keyword'] as const;
            const refBookLike = lang.categorizeRefBook(refBook, categories);

            let mdText = '# __spec__ Built-in Symbols\n\n';
            mdText += 'The contents of this page are cited from the _Reference Manual_ section in [PDF version](https://www.certif.com/downloads/css_docs/spec_man.pdf) of the _User manual and Tutorials_, written by [Certified Scientific Software](https://www.certif.com/), except where otherwise noted.\n\n';

            for (const [category, refSheet] of Object.entries(refBookLike)) {
                // If 'query' is not 'all', skip maps other than the speficed query.
                if (uri.query && uri.query !== 'all' && uri.query !== category) {
                    continue;
                }

                // Add heading for each category.
                mdText += `## ${lang.referenceCategoryMetadata[category as keyof typeof refBookLike].label}\n\n`;

                // Add each item.
                for (const [identifier, refItemLike] of Object.entries(refSheet)) {
                    mdText += `### ${identifier}\n\n`;
                    mdText += getFormattedStringForItem(refItemLike);
                    if (refItemLike.overloads) {
                        for (const overload of refItemLike.overloads) {
                            mdText += getFormattedStringForItem(overload);
                        }
                    }
                }
            }
            return mdText;
        }
    }
}

/**
 * Get an URI object of the external symbol file whose path is defined in the settings.
 */
function getExternalRefBookUri(): vscode.Uri | undefined {
    const path = vscode.workspace.getConfiguration('spec-command.suggest').get<string>('symbolFile', '');
    if (path === "") {
        return undefined;
    } else if (path.startsWith('${workspaceFolder}/')) {
        if (vscode.workspace.workspaceFile) {
            return vscode.Uri.joinPath(vscode.workspace.workspaceFile, path.replace('${workspaceFolder}/', '../'));
        } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            return vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, path.replace('${workspaceFolder}/', './'));
        } else {
            vscode.window.showErrorMessage('Failed to get the path to the external symbol file because a workspace folder does not exist.');
            return undefined;
        }
    } else if (path.startsWith('${userHome}/')) {
        const homedir = process.env.HOME || process.env.USERPROFILE; // || os.homedir();
        if (homedir) {
            return vscode.Uri.joinPath(vscode.Uri.file(homedir), path.replace('${userHome}/', './'));
        } else {
            vscode.window.showErrorMessage('Failed to get the path to the external symbol file. "${userHome}" is unavailable on the web extesion.');
            return undefined;
        }
    } else {
        return vscode.Uri.file(path);
    }
}

async function loadReferenceBook(fileUri: vscode.Uri): Promise<lang.ParsedData> {
    const uint8Array = await vscode.workspace.fs.readFile(fileUri);
    const decodedString = await vscode.workspace.decode(uint8Array, { encoding: 'utf8' });
    const refBookLike: lang.ReferenceBookLike = JSON.parse(decodedString);
    return { refBook: lang.flattenRefBook(refBookLike) };
}
