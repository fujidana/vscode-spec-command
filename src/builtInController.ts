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
export class BuiltInController extends Controller implements vscode.TextDocumentContentProvider {
    private activeWorkspaceFolder: vscode.WorkspaceFolder | undefined;
    public readonly promisedBuiltInRefBook: PromiseLike<lang.ReferenceBook | undefined>;
    public promisedExternalRefBook: PromiseLike<lang.ReferenceBook | undefined>;

    constructor(context: vscode.ExtensionContext) {
        super(context);

        // Load built-in symbol database from the JSON file.
        const builtInRefUri = vscode.Uri.joinPath(context.extensionUri, 'syntaxes', 'specCommand.builtIns.json');
        this.promisedBuiltInRefBook = this.loadReferenceBook(builtInRefUri, lang.BUILTIN_URI);

        // Load external symbol database from the JSON file.
        const externalRefUri = getExternalRefBookUri();
        if (externalRefUri) {
            this.promisedExternalRefBook = this.loadReferenceBook(externalRefUri, lang.EXTERNAL_URI).then(
                undefined, _reason => {
                    vscode.window.showErrorMessage(`Failed to load external symbols: ${externalRefUri.toString()}`, 'OK', 'Open Settings').then(
                        item => {
                            // Do not return a value so that the return value (promise-like object) of the function
                            // does not include waiting for an action against the dialog.
                            if (item === 'Open Settings') {
                                vscode.commands.executeCommand('workbench.action.openSettings', 'spec-command.suggest.sybmolFile');
                            }
                        }
                    );
                    return undefined;
                }
            );
        } else {
            this.promisedExternalRefBook = Promise.resolve(undefined);
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
            if (event.affectsConfiguration('spec-command.suggest.sybmolFile')) {
                const externalRefUri = getExternalRefBookUri();
                if (externalRefUri) {
                    this.promisedExternalRefBook = this.loadReferenceBook(externalRefUri, lang.EXTERNAL_URI).then(
                        undefined, _reason => {
                            vscode.window.showErrorMessage(`Failed to load external symbols: ${externalRefUri.toString()}`);
                            return undefined;
                        }
                    );
                }
            } else {
                this.promisedExternalRefBook = Promise.resolve(undefined);
            }
        };

        /** Command handler for opening the reference manual. */
        const showBuiltInSymbolsCommandHandler = async () => {
            const refBook = await this.promisedBuiltInRefBook;
            if (refBook === undefined) { return; }

            const quickPickItems = [{ category: 'all', label: '$(references) all' }];
            for (const category of Object.keys(refBook)) {
                const metadata = lang.referenceCategoryMetadata[category as keyof typeof refBook];
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
            // register command handlers
            vscode.commands.registerCommand('spec-command.showBuiltInSymbols', showBuiltInSymbolsCommandHandler),
            // register providers
            vscode.workspace.registerTextDocumentContentProvider('spec-command', this),
            // register event handlers
            vscode.window.onDidChangeActiveTextEditor(activeTextEditorDidChangeListener),
            vscode.workspace.onDidChangeConfiguration(configurationDidChangeListener),
        );
    }

    private loadReferenceBook(fileUri: vscode.Uri, key: string) {
        type ReferenceBookLike = { [K in lang.ReferenceCategory]?: { [key: string]: lang.ReferenceItem } };
        // type ReferenceBookLike = Partial<Record<lang.ReferenceCategory, Record<string, lang.ReferenceItem>>>;

        return vscode.workspace.fs.readFile(fileUri).then(
            uint8Array => {
                return vscode.workspace.decode(uint8Array, { encoding: 'utf8' }).then(
                    decodedString => {
                        const refBookLike: ReferenceBookLike = JSON.parse(decodedString);
                        const refBook: lang.ReferenceBook = {};

                        // Convert the object of each category to a Map object.
                        for (const [category, refSheetLike] of Object.entries(refBookLike)) {
                            refBook[category as keyof typeof refBookLike] = new Map(Object.entries(refSheetLike));
                        }

                        // Reigster it in the database.
                        this.referenceCollection.set(key, refBook);
                        this.updateCompletionItemsForUriString(key);
                        return refBook;
                    }
                );
            }
        );
    }
    /**
     * Update the reference database for motor or counter mnemonic.
     * Invoked when initialization completed or configuration modified. 
     */
    private updateMnemonicRefBook(kind: 'motors' | 'counters') {
        const uriString = kind === 'motors' ? lang.MOTOR_URI : lang.COUNTER_URI;
        const refSheet: lang.ReferenceSheet = new Map();

        const record = vscode.workspace.getConfiguration('spec-command.suggest', this.activeWorkspaceFolder).get<Record<string, string>>(kind);
        if (record) {
            const regExp = /^[a-zA-Z_][a-zA-Z0-9_]{0,6}$/;
            for (const [key, value] of Object.entries(record)) {
                if (regExp.test(key)) {
                    refSheet.set(key, { signature: key, description: value });
                }
            }
        }
        this.referenceCollection.set(uriString, { enum: refSheet });
        this.updateCompletionItemsForUriString(uriString);
    }

    /**
     * Update the reference database for snippets.
     * Invoked when initialization completed or configuration modified. 
     */
    private updateSnippetRefBook() {
        const refSheet: lang.ReferenceSheet = new Map();

        const userTemplates = vscode.workspace.getConfiguration('spec-command.suggest', this.activeWorkspaceFolder).get<Record<string, string>>('codeSnippets', {});
        const templates = Object.assign({}, SNIPPET_TEMPLATES, userTemplates);

        const motorRefSheet = this.referenceCollection.get(lang.MOTOR_URI)?.['enum'];
        const counterRefSheet = this.referenceCollection.get(lang.COUNTER_URI)?.['enum'];
        const motorChoiceString = (motorRefSheet && motorRefSheet.size > 0) ?
            '|' + [...motorRefSheet.keys()].join(',') + '|' :
            ':motor$1';
        const counterChoiceString = (counterRefSheet && counterRefSheet.size > 0) ?
            '|' + [...counterRefSheet.keys()].join(',') + '|' :
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
                refSheet.set(key, { signature, description, snippet });
            }
        }
        this.referenceCollection.set(lang.SNIPPET_URI, { snippet: refSheet });
        this.updateCompletionItemsForUriString(lang.SNIPPET_URI);
    }

    /**
     * Required implementation of vscode.TextDocumentContentProvider.
     */
    public provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<string> {
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
            const refBook = this.referenceCollection.get(lang.BUILTIN_URI);
            if (refBook) {
                let mdText = '# __spec__ Reference Manual\n\n';
                mdText += 'The contents of this page are cited from the _Reference Manual_ section in [PDF version](https://www.certif.com/downloads/css_docs/spec_man.pdf) of the _User manual and Tutorials_, written by [Certified Scientific Software](https://www.certif.com/), except where otherwise noted.\n\n';

                for (const [category, refSheet] of Object.entries(refBook)) {
                    // if 'query' is not 'all', skip maps other than the speficed query.
                    if (uri.query && uri.query !== 'all' && uri.query !== category) {
                        continue;
                    }

                    // add heading for each category
                    mdText += `## ${lang.referenceCategoryMetadata[category as keyof typeof refBook].label}\n\n`;

                    // add each item
                    for (const [identifier, refItem] of refSheet.entries()) {
                        mdText += `### ${identifier}\n\n`;
                        mdText += getFormattedStringForItem(refItem);
                        if (refItem.overloads) {
                            for (const overload of refItem.overloads) {
                                mdText += getFormattedStringForItem(overload);
                            }
                        }
                    }
                }
                return mdText;
            }
        }
    }
}

/**
 * Get an URI object of the external symbol file whose path is specified in 
 */
function getExternalRefBookUri() {
    const path = vscode.workspace.getConfiguration('spec-command.suggest').get<string>('sybmolFile', '');
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
