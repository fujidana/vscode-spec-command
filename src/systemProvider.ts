import * as vscode from 'vscode';
import { TextDecoder } from "util";
import * as spec from "./spec";
import { Provider } from "./provider";

interface APIReference {
    constants: spec.ReferenceItem[];
    variables: spec.ReferenceItem[];
    functions: spec.ReferenceItem[];
    macros: spec.ReferenceItem[];
    keywords: spec.ReferenceItem[];
}

const SNIPPET_TEMPLATES: string[] = [
    'mv ${1%MOT} ${2:pos} # absolute-position motor move',
    'mvr ${1%MOT} ${2:pos} # relative-position motor move',
    'umv ${1%MOT} ${2:pos} # absolute-position motor move (live update)',
    'umvr ${1%MOT} ${2:pos} # relative-position motor move (live update)',
    'ascan ${1%MOT} ${2:begin} ${3:end} ${4:steps} ${5:sec} # single-motor absolute-position scan',
    'dscan ${1%MOT} ${2:begin} ${3:end} ${4:steps} ${5:sec} # single-motor relative-position scan',
    'a2scan ${1%MOT} ${2:begin1} ${3:end1} ${4%MOT} ${5:begin2} ${6:end2} ${7:steps} ${8:sec} # two-motor absolute-position scan',
    'd2scan ${1%MOT} ${2:begin1} ${3:end1} ${4%MOT} ${5:begin2} ${6:end2} ${7:steps} ${8:sec} # two-motor relative-position scan',
    'mesh ${1%MOT} ${2:begin1} ${3:end1} ${4:step1} ${5%MOT} ${6:begin2} ${7:end2} ${8:steps2} ${9:sec} # nested two-motor scan that scanned over a grid of points',
    'a3scan ${1%MOT} ${2:begin1} ${3:end1} ${4%MOT} ${5:begin2} ${6:end2} ${7%MOT} ${8:begin3} ${9:end3} ${10:steps} ${11:sec} # single-motor absolute-position scan',
    'd3scan ${1%MOT} ${2:begin1} ${3:end1} ${4%MOT} ${5:begin2} ${6:end2} ${7%MOT} ${8:begin3} ${9:end3} ${10:steps} ${11:sec} # single-motor relative-position scan',
    'a4scan ${1%MOT} ${2:begin1} ${3:end1} ${4%MOT} ${5:begin2} ${6:end2} ${7%MOT} ${8:begin3} ${9:end3} ${10%MOT} ${11:begin4} ${12:end4} ${13:steps} ${14:sec} # four-motor absolute-position scan',
    'd4scan ${1%MOT} ${2:begin1} ${3:end1} ${4%MOT} ${5:begin2} ${6:end2} ${7%MOT} ${8:begin3} ${9:end3} ${10%MOT} ${11:begin4} ${12:end4} ${13:steps} ${14:sec} # four-motor relative-position sca',
];
/**
 * Provider for symbols that spec system manages.
 * This class manages built-in symbols and motor mnemonics user added in VS Code configuraion.
 */
export class SystemProvider extends Provider implements vscode.TextDocumentContentProvider {
    constructor(context: vscode.ExtensionContext) {
        super(context);

        // load the API reference file
        const apiReferencePath = context.asAbsolutePath('./syntaxes/spec.apiReference.json');
        vscode.workspace.fs.readFile(vscode.Uri.file(apiReferencePath)).then(uint8Array => {
            // convert JSON-formatted file contents to a javascript object.
            const apiReference: APIReference = JSON.parse(new TextDecoder('utf-8').decode(uint8Array));

            // convert the object to ReferenceMap and register the set.
            const builtinStorage: spec.ReferenceStorage = new Map(
                [
                    [spec.ReferenceItemKind.Constant, new Map(Object.entries(apiReference.constants))],
                    [spec.ReferenceItemKind.Variable, new Map(Object.entries(apiReference.variables))],
                    [spec.ReferenceItemKind.Macro, new Map(Object.entries(apiReference.macros))],
                    [spec.ReferenceItemKind.Function, new Map(Object.entries(apiReference.functions))],
                    [spec.ReferenceItemKind.Keyword, new Map(Object.entries(apiReference.keywords))],
                ]
            );
            this.storageCollection.set(spec.BUILTIN_URI, builtinStorage);
            this.updateCompletionItemsForUriString(spec.BUILTIN_URI);
        });

        // register motor and counter mnemonic storages and snippet storage.
        this.storageCollection.set(spec.MOTOR_URI, new Map([[spec.ReferenceItemKind.Enum, new Map()]]));
        this.storageCollection.set(spec.COUNTER_URI, new Map([[spec.ReferenceItemKind.Enum, new Map()]]));
        this.storageCollection.set(spec.SNIPPET_URI, new Map([[spec.ReferenceItemKind.Snippet, new Map()]]));
        this.updateMnemonicStorage(spec.MOTOR_URI, 'motors');
        this.updateMnemonicStorage(spec.COUNTER_URI, 'counters');
        this.updateSnippetStorage();

        // observe the change in configuration
        const onDidChangeConfigurationListener = (event: vscode.ConfigurationChangeEvent) => {
            if (event.affectsConfiguration('vscode-spec.mnemonic.motors')) {
                this.updateMnemonicStorage(spec.MOTOR_URI, 'motors');
                this.updateSnippetStorage();
            }
            if (event.affectsConfiguration('vscode-spec.mnemonic.counters')) {
                this.updateMnemonicStorage(spec.COUNTER_URI, 'counters');
                this.updateSnippetStorage();
            }
            if (event.affectsConfiguration('vscode-spec.editor.codeSnippets')) {
                this.updateSnippetStorage();
            }
        };

        // register command to show reference manual as a virtual document
        const openReferenceManualCommandCallback = () => {
            const storage = this.storageCollection.get(spec.BUILTIN_URI);
            if (storage) {
                const quickPickLabels = ['all'];
                for (const itemKind of storage.keys()) {
                    quickPickLabels.push(spec.getStringFromReferenceItemKind(itemKind));
                }
                vscode.window.showQuickPick(quickPickLabels).then(quickPickLabel => {
                    if (quickPickLabel) {
                        let uri = vscode.Uri.parse(spec.BUILTIN_URI);
                        if (quickPickLabel !== 'all') {
                            uri = uri.with({ query: quickPickLabel });
                        }
                        vscode.window.showTextDocument(uri, { preview: false });
                    }
                });
            }
        };

        context.subscriptions.push(
            // register command handlers
            vscode.commands.registerCommand('vscode-spec.openReferenceManual', openReferenceManualCommandCallback),
            vscode.workspace.registerTextDocumentContentProvider('spec', this),
            // register event handlers
            vscode.workspace.onDidChangeConfiguration(onDidChangeConfigurationListener),
        );
    }

    /**
     * Update the contents of motor or counter mnemonic storage.
     * Invoked when initialization completed or configuration modified. 
     */
    private updateMnemonicStorage(uriString: string, sectionString: string) {
        const enumRefMap = this.storageCollection.get(uriString)?.get(spec.ReferenceItemKind.Enum);
        if (!enumRefMap) { return; }
        enumRefMap.clear();

        const mneStrings: string[] = vscode.workspace.getConfiguration('vscode-spec.mnemonic').get(sectionString, []);

        if (mneStrings.length > 0) {
            // 'tth # two-theta' -> Array ["tth # two-theta", "tth", " # two-theta", "two-theta"]
            const regexp = /^([a-zA-Z_][a-zA-Z0-9_]{0,6})\s*(#\s*(.*))?$/;

            for (const mneString of mneStrings) {
                const match = mneString.match(regexp);
                if (match) {
                    enumRefMap.set(match[1], { signature: match[1], description: match[3] });
                }
            }
        }
        this.updateCompletionItemsForUriString(uriString);
    }

    /**
     * Update the contents of motor-mnemonic storage.
     * Invoked when initialization completed or configuration modified. 
     */
    private updateSnippetStorage() {
        const snippetRefMap = this.storageCollection.get(spec.SNIPPET_URI)?.get(spec.ReferenceItemKind.Snippet);
        if (!snippetRefMap) { return; }
        snippetRefMap.clear();

        const userSnippetStrings: string[] = vscode.workspace.getConfiguration('vscode-spec.editor').get('codeSnippets', []);
        const snippetStrings = SNIPPET_TEMPLATES.concat(userSnippetStrings);

        const motorEnumRefMap = this.storageCollection.get(spec.MOTOR_URI)?.get(spec.ReferenceItemKind.Enum);
        const counterEnumRefMap = this.storageCollection.get(spec.COUNTER_URI)?.get(spec.ReferenceItemKind.Enum);
        const motorChoiceString = (motorEnumRefMap && motorEnumRefMap.size > 0) ?
            '|' + Array.from(motorEnumRefMap.keys()).join(',') + '|' :
            ':motor';
        const counterChoiceString = (counterEnumRefMap && counterEnumRefMap.size > 0) ?
            '|' + Array.from(counterEnumRefMap.keys()).join(',') + '|' :
            ':counter';

        // 'mv ${1%MOT} ${2:pos} # motor move' -> Array ["mv ${1%MOT} ${2:pos} # motor move", "mv ${1%MOT} ${2:pos}", "mv", "# motor move", "motor move"]
        const mainRegexp = /^(([a-zA-Z_][a-zA-Z0-9_]*)\s+[^#]+?)\s*(#\s*(.*))?$/;
        const motorRegexp = /%MOT/g;
        const counterRegexp = /%CNT/g;
        const placeHolderRegexp = /\${\d+:([^{}]+)}/g;
        const choiceRegexp = /\${\d+\|[^|]+\|}/g;

        for (const snippetString of snippetStrings) {
            const match = snippetString.match(mainRegexp);
            if (match) {
                const snippetKey = match[2];
                const snippetSignature = match[1].replace(motorRegexp, ':motor').replace(counterRegexp, ':counter').replace(placeHolderRegexp, '$1').replace(choiceRegexp, 'choice');
                const snippetCode = match[1].replace(motorRegexp, motorChoiceString).replace(counterRegexp, counterChoiceString);
                const snippetDesription = match[4];

                snippetRefMap.set(snippetKey, { signature: snippetSignature, description: snippetDesription, snippet: snippetCode });
            }
        }
        this.updateCompletionItemsForUriString(spec.SNIPPET_URI);
    }

    /**
     * required implementation of vscode.TextDocumentContentProvider
     */
    public provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<string> {
        if (token.isCancellationRequested) { return; }

        if (uri.scheme === 'spec' && uri.authority === 'system') {
            const storage = this.storageCollection.get(uri.with({ query: '' }).toString());
            if (storage) {
                let mdText = '# __spec__ Reference Manual\n\n';
                mdText += 'The contents of this page are cited from the _Reference Manual_ section in [PDF version](https://www.certif.com/downloads/css_docs/spec_man.pdf) of the _User manual and Tutorials_, written by [Certified Scientific Software](https://www.certif.com/), except where otherwise noted.\n\n';

                for (const [itemKind, map] of storage.entries()) {
                    const itemKindString = spec.getStringFromReferenceItemKind(itemKind);

                    // if 'query' is specified, skip maps other than the speficed query.
                    if (uri.query && uri.query !== itemKindString) {
                        continue;
                    }

                    // add heading for each category
                    mdText += `## ${itemKindString}\n\n`;

                    // add each item
                    for (const [key, item] of map.entries()) {
                        mdText += `### ${key}\n\n`;
                        mdText += `\`${item.signature}\``;
                        mdText += (item.description) ? ` \u2014 ${item.description}\n\n` : '\n\n';
                        mdText += (item.comments) ? `${item.comments}\n\n` : '';

                        if (item.overloads) {
                            for (const overload of item.overloads) {
                                mdText += `\`${overload.signature}\``;
                                mdText += (overload.description) ? ` \u2014 ${overload.description}\n\n` : '\n\n';
                            }
                        }
                    }
                }
                return mdText;
            }
        }
    }
}
