import * as vscode from 'vscode';
import * as lang from "./language";
import { Controller } from "./controller";

const BUILTIN_DICT_URI = 'spec-command://extension/builtins';
const GLOBAL_DICT_BASEURI = 'spec-command://global/global';
const WORKSPACE_DICT_BASEURI = 'spec-command://workspace/workspace';
const SETTING_DICT_URI = 'spec-command://extension/setting';
const SNIPPET_DICT_URI = 'spec-command://extension/code-snippet';

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
export class DictionaryController extends Controller<lang.UpdateSession<lang.DictParserResult>> implements vscode.TextDocumentContentProvider {
    private readonly extensionSchemaUriString: string;
    private readonly dataStorageParams: { memento: vscode.Memento; scope: 'global' | 'workspace'; label: string }[];

    public fileUpdateSessionMap: Map<string, lang.UpdateSession> | undefined;

    constructor(context: vscode.ExtensionContext) {
        super(context);

        this.extensionSchemaUriString = vscode.Uri.joinPath(context.extensionUri, 'schema', 'scdict.schema.json').toString();

        this.dataStorageParams = [
            { memento: context.globalState, scope: 'global', label: vscode.l10n.t('User') },
            { memento: context.workspaceState, scope: 'workspace', label: vscode.l10n.t('Workspace') },
        ];

        // Load built-in symbol database from a JSON file bundled in the extension.
        this.updateSessionMap.set(BUILTIN_DICT_URI, {
            promise: loadDictionary(vscode.Uri.joinPath(context.extensionUri, 'syntaxes', 'spec-command.scdict.json'))
        });

        // Load user-defined symbol database from the global (user) and workspace state.
        this.loadUserDefinedDictionaries(false);

        // [spec-command specific code]
        // Initialize reference database for motors, counters and snippets.
        this.updateMnemonicRefBook();
        this.updateSnippetRefBook();

        /** Event listener for configuration changes. */
        const configurationDidChangeListener = (event: vscode.ConfigurationChangeEvent) => {
            if (event.affectsConfiguration('spec-command.suggest.motors') || event.affectsConfiguration('spec-command.suggest.counters')) {
                this.updateMnemonicRefBook();
                this.updateSnippetRefBook();
            }
            if (event.affectsConfiguration('spec-command.suggest.codeSnippets')) {
                this.updateSnippetRefBook();
            }
            if (event.affectsConfiguration('spec-command.suggest.dictionariesInclude')) {
                this.loadUserDefinedDictionaries(true, 'global');
                this.updateSnippetRefBook();
            }
        };

        interface QuickPickItemForDict extends vscode.QuickPickItem {
            scope: lang.DictParserResult['scope'];
            template?: 'empty' | 'workspaceSymbols' | undefined;
        }

        /**
         * Command handler for showing the content of dictionary as a virtual document in Markdown format.
         * This function simply tells the application to open a URI for the selected dictionary.
         * The content generation is delegated to the TextDocumentContentProvider (i.e. this controller).
         */
        const showDictionaryPreviewCommandHandler = async (..._args: any[]) => {
            const quickPickItems: QuickPickItemForDict[] = [
                { label: vscode.l10n.t('Extension'), kind: vscode.QuickPickItemKind.Separator, scope: 'extension' },
                { label: '[builtins]', scope: 'extension' },
            ];

            for (const { memento, scope, label } of this.dataStorageParams) {
                const dictionaries = memento.get<lang.CategorizedDictionary[]>('dictionaries');
                if (dictionaries && dictionaries.length > 0) {
                    quickPickItems.push({ label, kind: vscode.QuickPickItemKind.Separator, scope });
                    dictionaries.forEach(dict => quickPickItems.push({ label: dict.identifier, description: dict.name, scope }));
                }
            }

            // Show quick pick to select a dictionary.
            const selectedItem = await vscode.window.showQuickPick(quickPickItems, {
                placeHolder: vscode.l10n.t('Select a dictionary to preview'),
            });
            if (!selectedItem) { return; } // Exit if the user cancels.

            // Create a URI for the selected dictionary and ask the application to open it.
            // For the extension to recognize the content as a markdown document, append ".md" suffix to the URI path.
            let uri: vscode.Uri | undefined;
            if (selectedItem.scope === 'extension') {
                if (selectedItem.label === '[builtins]') {
                    uri = vscode.Uri.parse(BUILTIN_DICT_URI + '.md');
                }
            } else if (selectedItem.scope === 'global') {
                uri = vscode.Uri.parse(GLOBAL_DICT_BASEURI + '/' + selectedItem.label + '.md');
            } else if (selectedItem.scope === 'workspace') {
                uri = vscode.Uri.parse(WORKSPACE_DICT_BASEURI + '/' + selectedItem.label + '.md');
            }

            // If the URI is created successfully, open it with the preview mode according to the user setting.
            if (uri) {
                uri = uri.with({ query: 'dictionaryPreview' });

                type DictionaryPreviewOption = 'markdown' | 'preview' | 'markdown+preview';
                const option = vscode.workspace.getConfiguration('spec-command').get<DictionaryPreviewOption>('dictionaryPreview', 'preview');

                if (option === 'preview') {
                    // Show preview directly without showing the source markdown document.
                    // While not documented (AFAIK), the 'markdown.showPreview' command can accept a URI as an argument to specify which document to preview.
                    await vscode.commands.executeCommand('markdown.showPreview', uri);
                    return;
                } else if (option === 'markdown' || option === 'markdown+preview') {
                    // Show the source markdown document.
                    // If the option is 'markdown+preview', also show the preview.
                    await vscode.window.showTextDocument(uri, { preview: false });
                    if (option === 'markdown+preview') {
                        await vscode.commands.executeCommand('markdown.showPreview');
                    }
                }
            }
        };

        /**
         * Command handler for showing the content of dictionary in JSON format as a new document.
         */
        const showDictionarySourceCommandHandler = async (..._args: any[]) => {
            const quickPickItems: QuickPickItemForDict[] = [];

            for (const { memento, scope, label } of this.dataStorageParams) {
                const dictionaries = memento.get<lang.CategorizedDictionary[]>('dictionaries', []);
                quickPickItems.push({ label, kind: vscode.QuickPickItemKind.Separator, scope });
                dictionaries.forEach(dict => quickPickItems.push({ label: dict.identifier, description: dict.name, scope }));
                quickPickItems.push({ label: `[${scope}-empty]`, description: vscode.l10n.t('new dictionary with empty content'), scope, template: 'empty' });
                if (vscode.workspace.workspaceFolders) {
                    quickPickItems.push({ label: `[${scope}-template]`, description: vscode.l10n.t('new dictionary with current workspace symbols'), scope, template: 'workspaceSymbols' });
                }
            }

            // Show quick pick to select a dictionary.
            const selectedItem = await vscode.window.showQuickPick(quickPickItems, {
                placeHolder: vscode.l10n.t('Select a dictionary to view or edit'),
            });
            if (!selectedItem) { return; } // Exit if the user cancels.

            // Fetch the dictionary from the global/workspace state or create a new dictionary.
            let dict: lang.CategorizedDictionary | undefined;
            if (selectedItem.template === undefined) {
                // Fetch the dictionary from the global/workspace state.
                const memento = selectedItem.scope === 'global' ? context.globalState : context.workspaceState;
                const dictionaries = memento.get<lang.CategorizedDictionary[]>('dictionaries', []);
                dict = dictionaries.find(dict => dict.identifier === selectedItem.label);
            } else {
                // If the user selects a template with current workspace symbols,
                // gather symbols from all files in the workspace and put them in a dictionary.
                // Else, create an empty dictionary.
                const refBookEntries: [string, lang.ReferenceItem][] = [];

                if (selectedItem.template === 'workspaceSymbols' && this.fileUpdateSessionMap) {
                    for (const [uriString, session] of this.fileUpdateSessionMap.entries()) {
                        // Local variables are not exported.
                        if (uriString === lang.ACTIVE_FILE_URI) { continue; }

                        // Skip files that are not parsed successfully.
                        const refBook = (await session.promise)?.refBook;
                        if (refBook === undefined) { continue; }

                        refBookEntries.push(...refBook.entries());
                    }
                }
                const categoryFilters = ['constant', 'variable', 'array', 'macro', 'function'] as const;
                dict = lang.convertToCategorizedDictionary({
                    $schema: this.extensionSchemaUriString, // this.externalSchemaUriString,
                    identifier: selectedItem.scope === 'global' ? 'globalDict' : 'workspaceDict',
                    scope: selectedItem.scope,
                    refBook: new Map(refBookEntries),
                }, categoryFilters);
            }

            // Open a new text document with the content of the selected dictionary in JSON format.
            if (!dict) {
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to load the dictionary content.'));
            } else {
                const content = JSON.stringify(dict, ((key, value) => key === 'location' ? undefined : value), 2);
                const document = await vscode.workspace.openTextDocument({ language: 'json', content: content });
                await vscode.window.showTextDocument(document);
                return;
            }
        };

        /**
         * Command handler for registering a dictionary from the text content of the active editor.
         */
        const registerDictionaryCommandHandler = async (..._args: any[]) => {
            // Check if text content of active editor is a valid JSON.
            const editor = vscode.window.activeTextEditor;
            let obj: lang.CategorizedDictionary | null | undefined;
            if (editor === undefined) {
                vscode.window.showErrorMessage(vscode.l10n.t('No active editor found.'));
                return;
            } else if (editor.document.languageId !== 'json') {
                vscode.window.showErrorMessage(vscode.l10n.t('Document content is not in JSON format.'));
                return;
            } else if (vscode.languages.getDiagnostics(editor.document.uri).length > 0) {
                vscode.window.showErrorMessage(vscode.l10n.t('Document has validation errors.'));
                return;
            }

            // Parse JSON and do minimal validation for required properties.
            try {
                obj = JSON.parse(editor.document.getText());
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to parse JSON. {0}', errorMessage));
                return;
            }

            if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
                vscode.window.showErrorMessage(vscode.l10n.t('Document content must be a JSON object (not array or null).'));
                return;
            } else if ((/\/(.+\.)?scdict\.json$/.test(editor.document.uri.path)) === false && (!('$schema' in obj) || typeof obj.$schema !== 'string')) {
                // The JSON file must be validated by the JSON schema.
                // If the filename of the JSON file ends with 'scdict.json', the JSON schema validation is automatically applied by VS Code.
                // Otherwise, the extension requires the user to explicitly include the $schema property in the JSON content.
                vscode.window.showErrorMessage(vscode.l10n.t('JSON object is not validated by the JSON schema.'));
                return;
            } else if (!('kind' in obj) || obj.kind !== 'spec-command.dictionary') {
                vscode.window.showErrorMessage(vscode.l10n.t('JSON object must have the "{0}" value for the "{1}" key.', 'spec-command.dictionary', 'kind'));
                return;
            } else if (!('identifier' in obj) || typeof obj.identifier !== 'string') {
                vscode.window.showErrorMessage(vscode.l10n.t('JSON object must have a value of {0} type for the "{1}" key.', 'string', 'identifier'));
                return;
            } else if (!('scope' in obj) || typeof obj.scope !== 'string') {
                vscode.window.showErrorMessage(vscode.l10n.t('JSON object must have a value of {0} type for the "{1}" key.', 'string', 'scope'));
                return;
            } else if (obj.scope !== 'global' && obj.scope !== 'workspace') {
                vscode.window.showErrorMessage(vscode.l10n.t('Only "global" and "workspace" are the allowed values for the "scope" key.'));
                return;
            } else if (!('categories' in obj) || obj.categories !== null && typeof obj.categories !== 'object' || Array.isArray(obj.categories)) {
                vscode.window.showErrorMessage(vscode.l10n.t('JSON object must have a value of {0} type for the "{1}" key.', 'object', 'categories'));
                return;
            }

            let storageLabel: string;
            let uriString: string;
            let memento: vscode.Memento;
            if (obj.scope === 'global') {
                storageLabel = vscode.l10n.t('User');
                uriString = GLOBAL_DICT_BASEURI + '/' + obj.identifier;
                memento = context.globalState;
            } else { // if (obj.scope === 'workspace') {
                storageLabel = vscode.l10n.t('Workspace');
                uriString = WORKSPACE_DICT_BASEURI + '/' + obj.identifier;
                memento = context.workspaceState;
            }
            const dictionaries = memento.get<lang.CategorizedDictionary[]>('dictionaries', []);

            // Show confirmation if a dictionary with the same identifier already exists in the target storage,
            // Else proceed to register the dictionary without confirmation.
            const index = dictionaries.findIndex(dict => dict.identifier === obj.identifier);
            const flag = index === -1 ?
                vscode.l10n.t('OK') :
                await vscode.window.showWarningMessage<string>(
                    vscode.l10n.t('Are you sure you want to update the dictionary "{0}" in {1} storage with the current editor content?', obj.identifier, storageLabel),
                    { modal: true, detail: vscode.l10n.t('This action cannot be undone.') },
                    vscode.l10n.t('OK'));
            if (flag === vscode.l10n.t('OK')) {
                try {
                    const dictParserResult = lang.convertFromCategorizedDictionary(obj);
                    this.updateSessionMap.set(uriString, { promise: Promise.resolve(dictParserResult) });
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(vscode.l10n.t('Failed to convert dictionary. {0}', errorMessage));
                    return;
                }
                if (index === -1) {
                    vscode.window.showInformationMessage(vscode.l10n.t('Dictionary "{0}" has been created in {1} storage.', obj.identifier, storageLabel));
                    dictionaries.push(obj);
                } else {
                    vscode.window.showInformationMessage(vscode.l10n.t('Dictionary "{0}" in {1} storage has been updated.', obj.identifier, storageLabel));
                    dictionaries[index] = obj;
                }
                memento.update('dictionaries', dictionaries);
                this.loadUserDefinedDictionaries(true, obj.scope);

                // [spec-command specific code]
                this.updateMnemonicRefBook();
            }
        };

        /**
         * Command handler for deleting a dictionary from the global/workspace state.
         */
        const deleteDictionaryCommandHandler = async (_args: any[]) => {
            const quickPickItems: QuickPickItemForDict[] = [];

            for (const { memento, scope, label } of this.dataStorageParams) {
                const dictionaries = memento.get<lang.CategorizedDictionary[]>('dictionaries');
                if (dictionaries && dictionaries.length > 0) {
                    quickPickItems.push({ label, scope, kind: vscode.QuickPickItemKind.Separator });
                    dictionaries.forEach(dict => quickPickItems.push({ label: dict.identifier, description: dict.name, scope }));
                }
            }

            const quickPickOptions: vscode.QuickPickOptions = {
                placeHolder: vscode.l10n.t('Select a dictionary to delete'),
            };

            // If no dictionaries are registered, show a message and exit.
            if (quickPickItems.length === 0) {
                vscode.window.showQuickPick([vscode.l10n.t('{0} No dictionaries to delete.', '$(extensions-info-message)')], quickPickOptions);
                return;
            }

            // Else, show quick pick to select a dictionary to delete.
            const selectedItem = await vscode.window.showQuickPick(quickPickItems, quickPickOptions);
            if (!selectedItem) { return; } // Exit if the user cancels.

            // Show additional confirmation and continue if the user confirms the deletion.
            const flag = await vscode.window.showWarningMessage(
                vscode.l10n.t('Are you sure you want to delete the dictionary "{0}"?', selectedItem.label),
                { modal: true, detail: vscode.l10n.t('This action cannot be undone.') },
                vscode.l10n.t('OK')
            );
            if (flag === vscode.l10n.t('OK')) {
                let uriString: string;
                let memento: vscode.Memento;
                if (selectedItem.scope === 'global') {
                    uriString = GLOBAL_DICT_BASEURI + '/' + selectedItem.label;
                    memento = context.globalState;
                } else { // if (selectedItem.scope === 'workspace') {
                    uriString = WORKSPACE_DICT_BASEURI + '/' + selectedItem.label;
                    memento = context.workspaceState;
                }
                const dictionaries = memento.get<lang.CategorizedDictionary[]>('dictionaries', []);
                // dictionaries.splice(dictionaries.findIndex(dict => dict.identifier === selectedItem.label), 1);
                const newDictionaries = dictionaries.filter(dict => dict.identifier !== selectedItem.label);
                memento.update('dictionaries', newDictionaries);
                this.updateSessionMap.delete(uriString);

                // [spec-command specific code]
                this.updateMnemonicRefBook();
            }
        };

        /**
         * Command handler for reloading dictionaries from the global/workspace state.
         */
        const reloadDictionariesCommandHandler = async (_args: any[]) => {
            this.loadUserDefinedDictionaries(true);
            this.updateSnippetRefBook();
        };

        // Register command and event handlers.
        context.subscriptions.push(
            // Register command handlers.
            vscode.commands.registerCommand('spec-command.showDictionaryPreview', showDictionaryPreviewCommandHandler),
            vscode.commands.registerCommand('spec-command.showDictionarySource', showDictionarySourceCommandHandler),
            vscode.commands.registerCommand('spec-command.registerDictionary', registerDictionaryCommandHandler),
            vscode.commands.registerCommand('spec-command.deleteDictionary', deleteDictionaryCommandHandler),
            vscode.commands.registerCommand('spec-command.reloadDictionaries', reloadDictionariesCommandHandler),
            // Register providers.
            vscode.workspace.registerTextDocumentContentProvider('spec-command', this),
            // Register event handlers.
            vscode.workspace.onDidChangeConfiguration(configurationDidChangeListener),
        );

        // Ask the user to re-register old dictionaries, whose keys are not 'dictionaries'.
        for (const { memento, label } of this.dataStorageParams) {
            const oldKeys = memento.keys().filter(key => key !== 'dictionaries');
            if (oldKeys.length > 0) {
                vscode.window.showInformationMessage(vscode.l10n.t('Old {0} dictionaries were found: {1}. Register them using the [Register Editor Content as User-Defined Dictionary]({2}) command, if needed.', label, oldKeys.join(', '), 'command:spec-command.registerDictionary'));
                for (const oldKey of oldKeys) {
                    const dict = memento.get<lang.CategorizedDictionary>(oldKey);
                    if (dict) {
                        const content = JSON.stringify(dict, ((key, value) => key === 'location' ? undefined : value), 2);
                        vscode.workspace.openTextDocument({ language: 'json', content: content }).then(
                            document => {
                                vscode.window.showTextDocument(document);
                            }
                        );
                    }
                    memento.update(oldKey, undefined);
                }
            }
        }

        // Set the keys for synchronization in the global state.
        context.globalState.setKeysForSync(['dictionaries']);
    }

    // Override the method in the base class to provide custom descriptions for completion items.
    // For entries in a built-in or user-defined dictionary, it returns a descriptive label.
    protected override getCompletionItemLabelDescription(uriString: string): string | undefined {
        if (uriString === BUILTIN_DICT_URI) {
            return '[built-in]';
        } else if (uriString.startsWith(GLOBAL_DICT_BASEURI)) {
            return `[global/${uriString.substring(GLOBAL_DICT_BASEURI.length + 1)}]`;
        } else if (uriString.startsWith(WORKSPACE_DICT_BASEURI)) {
            return `[workspace/${uriString.substring(WORKSPACE_DICT_BASEURI.length + 1)}]`;
        } else if (uriString === SETTING_DICT_URI) {
            return '[setting]';
        } else if (uriString === SNIPPET_DICT_URI) {
            return '[snippet]';
        } else {
            return undefined;
        }
    }

    // Override the method in the base class to provide short text on hover and resolved completion items.
    protected override getSignatureComment(categoryLabel: string, uriString: string): string {
        if (uriString === BUILTIN_DICT_URI) {
            return `built-in ${categoryLabel}`;
        } else if (uriString.startsWith(GLOBAL_DICT_BASEURI)) {
            return `${categoryLabel} in global/${uriString.substring(GLOBAL_DICT_BASEURI.length + 1)}`;
        } else if (uriString.startsWith(WORKSPACE_DICT_BASEURI)) {
            return `${categoryLabel} in workspace/${uriString.substring(WORKSPACE_DICT_BASEURI.length + 1)}`;
        } else if (uriString === SETTING_DICT_URI) {
            return `${categoryLabel} in setting`;
        } else if (uriString === SNIPPET_DICT_URI) {
            return `${categoryLabel} for counter/motor`;
        } else {
            return categoryLabel;
        }
    }

    /**
     * Update the reference database for motor and counter mnemonics.
     * Invoked when initialization completed or configuration modified. 
     */
    private updateMnemonicRefBook() {
        const settings: { category: 'motor' | 'counter'; configKey: string; configDefault: Record<string, string> }[] = [
            { category: 'motor', configKey: 'motors', configDefault: {} },
            { category: 'counter', configKey: 'counters', configDefault: { sec: 'count time in second' } },
        ];

        const refBook: lang.ReferenceBook = new Map();
        const config = vscode.workspace.getConfiguration('spec-command.suggest');
        const regExp = /^[a-zA-Z_][a-zA-Z0-9_]{0,6}$/;

        for (const { category, configKey, configDefault } of settings) {
            const record = config.get<Record<string, string>>(configKey, configDefault);
            for (const [signature, description] of Object.entries(record)) {
                if (regExp.test(signature)) {
                    refBook.set(signature, { signature, description, category });
                }
            }
        }

        this.updateSessionMap.set(SETTING_DICT_URI, { promise: Promise.resolve({ identifier: 'setting', scope: 'extension', refBook }) });
    }

    /**
     * Update the reference database for snippets.
     * Invoked when initialization completed or configuration modified. 
     */
    private async updateSnippetRefBook() {
        // Collect motor and counter mnemonics from setting and user-defined dictionaries.
        const counterMnemonics: string[] = [];
        const motorMnemonics: string[] = [];
        const parserResults = await Promise.all(
            [...this.updateSessionMap.entries()].filter(
                ([uriString, _session]) => uriString === SETTING_DICT_URI || uriString.startsWith(GLOBAL_DICT_BASEURI) || uriString.startsWith(WORKSPACE_DICT_BASEURI)
            ).map(
                ([_uriString, session]) => session.promise
            )
        );
        for (const parserResult of parserResults) {
            if (!parserResult) { continue; }

            for (const [key, item] of parserResult.refBook) {
                if (item.category === 'counter') {
                    counterMnemonics.push(key);
                } else if (item.category === 'motor') {
                    motorMnemonics.push(key);
                }
            }
        }

        const refBook: lang.ReferenceBook = new Map();
        const userTemplates = vscode.workspace.getConfiguration('spec-command.suggest').get<Record<string, string>>('codeSnippets', {});
        const templates = Object.assign({}, SNIPPET_TEMPLATES, userTemplates);
        const motorChoiceString = (motorMnemonics.length > 0) ?
            '|' + motorMnemonics.join(',') + '|' :
            ':motor$1';
        const counterChoiceString = (counterMnemonics.length > 0) ?
            '|' + counterMnemonics.join(',') + '|' :
            ':counter$1';

        // 'mv ${1%MOT} ${2:pos} # motor move' -> Array ["mv ${1%MOT} ${2:pos} # motor move", "mv ${1%MOT} ${2:pos}", "motor move"]
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
        this.updateSessionMap.set(SNIPPET_DICT_URI, { promise: Promise.resolve({ identifier: 'snippets', scope: 'extension', refBook }) });
    }

    /**
     * Loads user-defined dictionaries from the global and workspace state.
     * @param clearExisting Whether to clear existing dictionaries before loading.
     * @param storeKind Optional parameter to specify which storage to load from ('global' or 'workspace'). If undefined, loads from both.
     */
    private loadUserDefinedDictionaries(clearExisting: boolean, storeKind: 'global' | 'workspace' | undefined = undefined) {
        let dataStorageParams = this.dataStorageParams;
        if (storeKind) {
            dataStorageParams = dataStorageParams.filter(param => param.scope === storeKind);
        }

        for (const { scope, memento } of dataStorageParams) {
            const baseUriString = scope === 'global' ? GLOBAL_DICT_BASEURI : WORKSPACE_DICT_BASEURI;
            if (clearExisting) {
                const urisToRemove = [...this.updateSessionMap.keys()].filter(uriString => uriString.startsWith(baseUriString + '/'));
                urisToRemove.forEach(uriString => this.updateSessionMap.delete(uriString));
            }

            let dictionariesInclude: string[];
            if (scope === 'global') {
                dictionariesInclude = vscode.workspace.getConfiguration('spec-command.suggest').get<string[]>('dictionariesInclude', []);

            } else { //if (scope === 'workspace') {
                dictionariesInclude = [];

                // Skip loading user-defined symbol database from the workspace state if the workspace is not trusted, to avoid potential security risks.
                if (!vscode.workspace.isTrusted) {
                    continue;
                }
            }

            const dictionaries = memento.get<unknown[]>('dictionaries', []);
            for (const dict of dictionaries) {
                if (dict && typeof dict === 'object' && 'kind' in dict && dict.kind === 'spec-command.dictionary' && 'identifier' in dict && typeof dict.identifier === 'string') {
                    if (dictionariesInclude.length === 0 || dictionariesInclude.includes(dict.identifier)) {
                        const uriString = baseUriString + '/' + dict.identifier;
                        const promise = new Promise<lang.DictParserResult>(
                            resolve => { resolve(lang.convertFromCategorizedDictionary(dict as lang.CategorizedDictionary)); }
                        );
                        this.updateSessionMap.set(uriString, { promise });
                    }
                }
            }
        }
    }

    // Required implementation of vscode.TextDocumentContentProvider.
    public async provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): Promise<string | undefined> {
        /** Helper function to format a reference item as Markdown. */
        const getFormattedStringForItem = (item: Omit<lang.ReferenceItem, 'category'>) => {
            let mdText = `\`${item.signature}\``;
            mdText += item.description ? ` \u2014 ${item.description}\n\n` : '\n\n';
            if (item.available) {
                mdText += lang.getVersionRangeDescription(item.available, 'available') + '\n\n';
            }
            if (item.deprecated) {
                mdText += lang.getVersionRangeDescription(item.deprecated, 'deprecated') + '\n\n';
            }
            if (item.overloads) {
                for (const overload of item.overloads) {
                    mdText += getFormattedStringForItem(overload);
                }
            }
            return mdText;
        };

        if (token.isCancellationRequested) { return undefined; }

        // The URI must have the following format: 'spec-command://{extension|global|workspace}/{identifier}.md?dictionaryPreview'
        if (uri.scheme !== 'spec-command' || uri.query !== 'dictionaryPreview' || !uri.path.endsWith('.md')) {
            return undefined;
        }

        // Create a URI string for the dictionary by removing the '.md' suffix and query part from the URI,
        let uriString = uri.with({ query: '' }).toString(); // Remove the query part.
        uriString = uriString.substring(0, uriString.length - 3); // Remove '.md' suffix.
        if (uriString !== BUILTIN_DICT_URI && !uriString.startsWith(GLOBAL_DICT_BASEURI) && !uriString.startsWith(WORKSPACE_DICT_BASEURI)) {
            return undefined;
        }

        // Check if the parser result for the URI is available.
        const parserResult = await this.updateSessionMap.get(uriString)?.promise;
        if (!parserResult) { return undefined; }

        // Convert the parser result into a categorized dictionary and generate Markdown text for the preview.
        const dictionary = lang.convertToCategorizedDictionary(parserResult);

        // Add heading for the dictionary.
        let mdText = `# ${dictionary.name ?? dictionary.identifier} (${dictionary.scope})\n\n`;
        if (dictionary.description) {
            mdText += `${dictionary.description}\n\n`;
        }

        // Add Table of Contents.
        mdText += '## Table of Contents\n\n';
        for (const [categoryName, entriesInCategory] of Object.entries(dictionary.categories)) {
            if (Object.keys(entriesInCategory).length === 0) { continue; }
            const categoryLabel = lang.getLabelForCategory(categoryName as keyof typeof dictionary.categories);
            mdText += `- [${categoryLabel}](#${categoryLabel.toLowerCase().replace(/\s+/g, '-')})\n`;
        }
        mdText += '\n';

        // Add each category and its items.
        for (const [categoryName, entriesInCategory] of Object.entries(dictionary.categories)) {
            // Add heading for each category.
            if (Object.keys(entriesInCategory).length === 0) { continue; }
            mdText += `## ${lang.getLabelForCategory(categoryName as keyof typeof dictionary.categories)}\n\n`;

            // Add each item.
            for (const [identifier, entry] of Object.entries(entriesInCategory)) {
                mdText += `### ${identifier}\n\n`;
                mdText += getFormattedStringForItem(entry);
            }
        }
        return mdText;
    }
}

async function loadDictionary(fileUri: vscode.Uri): Promise<lang.DictParserResult | undefined> {
    try {
        const uint8Array = await vscode.workspace.fs.readFile(fileUri);
        const decodedString = await vscode.workspace.decode(uint8Array, { encoding: 'utf8' });
        const dictionary: lang.CategorizedDictionary = JSON.parse(decodedString);
        return lang.convertFromCategorizedDictionary(dictionary);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const message = vscode.l10n.t('Failed to load dictionary for built-in symbols. {0}', errorMessage);

        // Do not return a thenable object chained to `showErrorMessage()` so 
        // that the return value of the function is resolved before the user
        // takes an action against the dialog.
        vscode.window.showErrorMessage(message);
        return undefined;
    }
}
