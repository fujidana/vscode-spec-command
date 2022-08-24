import * as vscode from 'vscode';
import * as spec from './spec';

/* eslint-disable @typescript-eslint/naming-convention */
interface SuppressMessagesConfig {
    'completionItem.label.detail'?: boolean
    'completionItem.label.description'?: boolean
    'completionItem.documentation'?: boolean
    'signatureHelp.signatures.documentation'?: boolean
    'hover.contents'?: boolean
}
/* eslint-enable @typescript-eslint/naming-convention */

function getShortDescription(item: spec.ReferenceItem, itemKind: spec.ReferenceItemKind, itemUriString: string, documentUriString: string, outputsMarkdown: true): vscode.MarkdownString;
function getShortDescription(item: spec.ReferenceItem, itemKind: spec.ReferenceItemKind, itemUriString: string, documentUriString: string, outputsMarkdown: false): string;
function getShortDescription(item: spec.ReferenceItem, itemKind: spec.ReferenceItemKind, itemUriString: string, documentUriString: string, outputsMarkdown: boolean) {
    let symbolLabel: string;
    let itemUriLabel: string | undefined;

    symbolLabel = spec.getReferenceItemKindMetadata(itemKind).label;

    if (itemUriString === spec.BUILTIN_URI) {
        symbolLabel = 'built-in ' + symbolLabel;
    } else if (itemUriString === spec.MOTOR_URI) {
        symbolLabel = 'motor mnemonic ' + symbolLabel;
    } else if (itemUriString === spec.COUNTER_URI) {
        symbolLabel = 'counter mnemonic ' + symbolLabel;
    } else if (itemUriString === spec.SNIPPET_URI) {
        symbolLabel = 'counter/motor ' + symbolLabel;
    } else if (itemUriString === spec.ACTIVE_FILE_URI || itemUriString === documentUriString) {
        if (item.location) {
            symbolLabel = `${symbolLabel} defined in l.${item.location.start.line} of this file `;
        } else {
            symbolLabel = symbolLabel + ' defined in this file';
        }
    } else {
        const itemUri = vscode.Uri.parse(itemUriString);
        // itemUriLabel = (itemUri.scheme === 'file') ? vscode.workspace.asRelativePath(itemUri) : itemUriString;
        itemUriLabel = vscode.workspace.asRelativePath(itemUri);
        symbolLabel = outputsMarkdown ? 'user-defined ' + symbolLabel : symbolLabel + ' defined in ' + itemUriLabel;
    }

    let mainText = `${item.signature} # ${symbolLabel}`;
    if (item.overloads && item.overloads.length > 1) {
        mainText += `, ${item.overloads.length} overloads`;
    }

    if (outputsMarkdown) {
        let markdownString = new vscode.MarkdownString().appendCodeblock(mainText);
        if (itemUriLabel) {
            markdownString = markdownString.appendMarkdown(`_defined in_ [${itemUriLabel}](${itemUriString}).\n\n`);
        }
        return markdownString;
    } else {
        return mainText;
    }
}


const enum TruncationLevel {
    full = 0,
    paragraph,
    line
}

function truncateString(level: TruncationLevel, description?: string, comments?: string): string | undefined {
    let truncatedString;
    if (description) {
        if (level === TruncationLevel.full) {
            truncatedString = description;
        } else if (level === TruncationLevel.paragraph) {
            const endIndex = description.indexOf('\n\n');
            truncatedString = (endIndex >= 0) ? description.substring(0, endIndex) + '\n\n...' : description;
        } else if (level === TruncationLevel.line) {
            const endIndex = description.search(/\.\s/g);
            truncatedString = (endIndex >= 0) ? description.substring(0, endIndex) + '. ...' : description;
        }
    }

    if (comments && level !== TruncationLevel.line) {
        truncatedString = truncatedString ? truncatedString + '\n\n' + comments : comments;
    }

    return truncatedString;
}

function getParameterInformation(signature: string): vscode.ParameterInformation[] | undefined {
    const parenStart = signature.indexOf('(');
    const parenEnd = signature.lastIndexOf(')');
    if (parenStart < 0 || parenEnd < 0) {
        return undefined;
    }
    // const selectorName = signature.substring(0, parStart).trim();
    const parameters = signature.substring(parenStart + 1, parenEnd).trim().replace(/[[\]]/g, '').split(/\s*,\s*/);
    return parameters.map(parameter => new vscode.ParameterInformation(parameter));
}

function parseSignatureInEditing(line: string, position: number) {
    let substr = line.substring(0, position);

    // flatten paired parentheses:
    // from "parentfunc(sonfunc(a, b, c), daughterFunc(d, e"
    // to   "parentfunc(sonfunc_________, daughterFunc(d, e"
    for (; ;) {
        const newstr = substr.replace(/\([^()]*\)/g, substr => '_'.repeat(substr.length));
        if (newstr === substr) {
            substr = newstr;
            break;
        }
        substr = newstr;
    }

    // find an incomplete function call.
    // If the function calls are nested, get the last (i.e., the most nested) one.
    // currently I can not do in one-line regular expression.
    const regExp = /^(.*?)([a-zA-Z_][a-zA-Z0-9_]*)\(/;
    let prevMatch: RegExpMatchArray | null = null;
    let currMatch: RegExpMatchArray | null;
    while ((currMatch = substr.match(regExp)) !== null) {
        substr = substr.substring(currMatch[0].length);
        prevMatch = currMatch;
    }

    return prevMatch ? { 'signature': prevMatch[2], 'argumentIndex': substr.split(',').length - 1 } : undefined;
}

/**
 * Provider class
 */
export class CommandProvider implements vscode.CompletionItemProvider<spec.CompletionItem>, vscode.HoverProvider, vscode.SignatureHelpProvider {

    // vscode.Uri objects can not be used as a key for a Map object because these 
    // objects having the same string representation can be recognized different,
    // i.e., uriA.toString() === uriB.toString() but uriA !== uriB.
    // This is mainly caused by the difference in their minor properties, such as fsPath
    // (File System Path). To avoid this problem, the string representation of a Uri 
    // object is used as a key.

    protected readonly storageCollection = new Map<string, spec.ReferenceStorage>();
    protected readonly completionItemCollection = new Map<string, spec.CompletionItem[]>();

    constructor(context: vscode.ExtensionContext) {
        const configurationChangeListener = (event: vscode.ConfigurationChangeEvent) => {
            if (event.affectsConfiguration('spec-command.suggest.suppressMessages')) {
                for (const uriString of this.storageCollection.keys()) {
                    this.updateCompletionItemsForUriString(uriString);
                }
            }
        };

        // register providers
        context.subscriptions.push(
            vscode.languages.registerCompletionItemProvider(spec.CMD_SELECTOR, this),
            vscode.languages.registerHoverProvider(spec.CMD_SELECTOR, this),
            vscode.languages.registerSignatureHelpProvider(spec.CMD_SELECTOR, this, '(', ')', ','),
            vscode.workspace.onDidChangeConfiguration(configurationChangeListener),
        );
    }

    /**
     * Generate completion items from the registered storage and cache it in the map using `uri` as the key.
     * Subclass must invoke it when the storage contents are changed.
     */
    protected updateCompletionItemsForUriString(uriString: string): vscode.CompletionItem[] | undefined {
        const storage = this.storageCollection.get(uriString);
        if (storage) {
            const config = vscode.workspace.getConfiguration('spec-command.suggest').get<SuppressMessagesConfig>('suppressMessages');
            const suppressDetail = config !== undefined && 'completionItem.label.detail' in config && config['completionItem.label.detail'] === true;
            const suppressDescription = config !== undefined && 'completionItem.label.description' in config && config['completionItem.label.description'] === true;
            let description: string | undefined;

            if (!suppressDescription) {
                if (uriString === spec.BUILTIN_URI) {
                    description = 'built-in';
                } else if (uriString === spec.MOTOR_URI) {
                    description = 'motor';
                } else if (uriString === spec.COUNTER_URI) {
                    description = 'counter';
                } else if (uriString === spec.SNIPPET_URI) {
                    description = 'snippet';
                } else if (uriString === spec.ACTIVE_FILE_URI) {
                    // } else if (uriString === spec.ACTIVE_FILE_URI || uriString === vscode.window.activeTextEditor?.document.uri.toString()) {
                    description = 'local';
                } else {
                    const itemUri = vscode.Uri.parse(uriString);
                    // description = (itemUri.scheme === 'file') ? vscode.workspace.asRelativePath(itemUri) : uriString;
                    description = vscode.workspace.asRelativePath(itemUri);
                }
            }

            const completionItems: spec.CompletionItem[] = [];
            for (const [refItemKind, map] of storage.entries()) {
                for (const [identifier, item] of map.entries()) {
                    const detail = (!suppressDetail && item.signature.startsWith(identifier)) ? item.signature.substring(identifier.length) : undefined;
                    const label: vscode.CompletionItemLabel = { label: identifier, detail: detail, description: description };
                    const completionItem = new spec.CompletionItem(label, uriString, refItemKind);
                    if (item.snippet) {
                        completionItem.insertText = new vscode.SnippetString(item.snippet);
                    }
                    completionItems.push(completionItem);
                }
            }
            this.completionItemCollection.set(uriString, completionItems);
            return completionItems;
        } else {
            this.completionItemCollection.delete(uriString);
            return undefined;
        }
    }

    /**
     * Required implementation of vscode.CompletionItemProvider
     */
    public provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.ProviderResult<vscode.CompletionList<spec.CompletionItem> | spec.CompletionItem[]> {
        if (token.isCancellationRequested) { return; }

        const range = document.getWordRangeAtPosition(position);
        if (range === undefined) { return; }

        const selectorName = document.getText(range);
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(selectorName)) { return; }

        return new Array<spec.CompletionItem>().concat(...this.completionItemCollection.values());
    }

    /**
     * Optional implementation of vscode.CompletionItemProvider
     */
    public resolveCompletionItem(completionItem: spec.CompletionItem, token: vscode.CancellationToken): vscode.ProviderResult<spec.CompletionItem> {
        if (token.isCancellationRequested) { return; }

        const refItemKind = completionItem.refItemKind;
        const refUriString = completionItem.uriString;

        const activeEditor = vscode.window.activeTextEditor;
        const documentUriString = activeEditor ? activeEditor.document.uri.toString() : '';

        const config = vscode.workspace.getConfiguration('spec-command.suggest').get<SuppressMessagesConfig>('suppressMessages');
        const truncationlevel = (config !== undefined && 'completionItem.documentation' in config && config['completionItem.documentation'] === true) ? TruncationLevel.line : TruncationLevel.paragraph;

        // find the symbol information about the symbol.
        const label = typeof completionItem.label === 'string' ? completionItem.label : completionItem.label.label;
        const refItem = this.storageCollection.get(refUriString)?.get(refItemKind)?.get(label);
        if (refItem === undefined) { return; }

        // copy completion item.
        const newCompletionItem = Object.assign({}, completionItem);

        // set the detail of the completion item
        newCompletionItem.detail = getShortDescription(refItem, refItemKind, refUriString, documentUriString, false);

        // set the description of the completion item
        // if the main description exists, append it.

        const descriptionMarkdown = new vscode.MarkdownString(truncateString(truncationlevel, refItem.description, refItem.comments));

        // if overloaded signature exists, append them.
        if (refItem.overloads) {
            for (const overload of refItem.overloads) {
                // descriptionMarkdown.appendMarkdown('---');
                descriptionMarkdown.appendCodeblock(overload.signature);
                const truncatedString = truncateString(truncationlevel, overload.description, undefined);
                if (truncatedString) {
                    descriptionMarkdown.appendMarkdown(truncatedString);
                }
            }
        }

        if (descriptionMarkdown.value) {
            newCompletionItem.documentation = descriptionMarkdown;
        }
        return newCompletionItem;
    }

    /**
     * required implementation of vscode.HoverProvider
     */
    public provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Hover> {
        if (token.isCancellationRequested) { return; }

        const config = vscode.workspace.getConfiguration('spec-command.suggest').get<SuppressMessagesConfig>('suppressMessages');
        const truncationLevel = (config !== undefined && 'hover.contents' in config && config['hover.contents'] === true) ? TruncationLevel.paragraph : TruncationLevel.full;

        const range = document.getWordRangeAtPosition(position);
        if (range === undefined) { return; }

        const selectorName = document.getText(range);
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(selectorName)) { return; }

        // start to seek if the selection is a proper identifier.
        const contents: vscode.MarkdownString[] = [];

        for (const [refUriString, storage] of this.storageCollection.entries()) {
            for (const [itemKind, map] of storage.entries()) {
                // find the symbol information about the symbol.
                const item = map.get(selectorName);
                if (item) {
                    let mainMarkdown = getShortDescription(item, itemKind, refUriString, document.uri.toString(), true);

                    // prepare the second line: the description (if it exists)
                    const truncatedString = truncateString(truncationLevel, item.description, item.comments);
                    if (truncatedString) {
                        mainMarkdown = mainMarkdown.appendMarkdown(truncatedString);
                    }
                    contents.push(mainMarkdown);

                    // for overloaded functions, prepare additional markdown blocks
                    if (item.overloads) {
                        for (const overload of item.overloads) {
                            let overloadMarkdown = new vscode.MarkdownString().appendCodeblock(overload.signature);
                            const truncatedString2 = truncateString(truncationLevel, overload.description, undefined);
                            if (truncatedString2) {
                                overloadMarkdown = overloadMarkdown.appendMarkdown(truncatedString2);
                            }
                            contents.push(overloadMarkdown);
                        }
                    }
                }
            }
        }
        return contents.length > 0 ? new vscode.Hover(contents) : undefined;
    }

    /**
     * Required implementation of vscode.SignatureHelpProvider
     */
    public provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.SignatureHelpContext): vscode.ProviderResult<vscode.SignatureHelp> {
        if (token.isCancellationRequested) { return; }

        const signatureHint = parseSignatureInEditing(document.lineAt(position.line).text, position.character);
        if (signatureHint === undefined) { return; }

        const config = vscode.workspace.getConfiguration('spec-command.suggest').get<SuppressMessagesConfig>('suppressMessages');
        const truncationLevel = (config !== undefined && 'signatureHelp.signatures.documentation' in config && config['signatureHelp.signatures.documentation'] === true) ? TruncationLevel.paragraph : TruncationLevel.full;

        for (const storage of this.storageCollection.values()) {
            const map = storage.get(spec.ReferenceItemKind.Function);
            let item: spec.ReferenceItem | undefined;
            if (map && (item = map.get(signatureHint.signature)) !== undefined) {
                const overloads = (item.overloads) ? item.overloads : [{ signature: item.signature, description: item.description }];
                const signatureHelp = new vscode.SignatureHelp();

                for (const overload of overloads) {
                    // assume that usage.signature must exist.
                    const signatureInformation = new vscode.SignatureInformation(overload.signature);
                    const truncatedString = truncateString(truncationLevel, overload.description, undefined);
                    if (truncatedString) {
                        signatureInformation.documentation = new vscode.MarkdownString(truncatedString);
                    }
                    const parameters = getParameterInformation(overload.signature);
                    if (parameters !== undefined) {
                        signatureInformation.parameters = parameters;
                    }
                    signatureHelp.signatures.push(signatureInformation);
                }

                signatureHelp.activeParameter = signatureHint.argumentIndex;

                if ((context.activeSignatureHelp !== undefined) && (context.activeSignatureHelp.signatures[0].label === signatureHelp.signatures[0].label)) {
                    signatureHelp.activeSignature = context.activeSignatureHelp.activeSignature;
                } else {
                    signatureHelp.activeSignature = 0;
                }

                if (signatureHelp.activeSignature >= signatureHelp.signatures.length) {
                    signatureHelp.activeSignature = signatureHelp.signatures.length;
                }
                return signatureHelp;
            }
        }
    }
}
