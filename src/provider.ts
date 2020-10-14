import * as vscode from 'vscode';
import * as spec from './spec';


function getShortDescription(item: spec.ReferenceItem, itemKind: spec.ReferenceItemKind, itemUriString: string, documentUriString: string, outputsMarkdown: true): vscode.MarkdownString;
function getShortDescription(item: spec.ReferenceItem, itemKind: spec.ReferenceItemKind, itemUriString: string, documentUriString: string, outputsMarkdown: false): string;
function getShortDescription(item: spec.ReferenceItem, itemKind: spec.ReferenceItemKind, itemUriString: string, documentUriString: string, outputsMarkdown: boolean) {
    let symbolLabel: string;
    let itemUriLabel: string | undefined;

    symbolLabel = spec.getStringFromReferenceItemKind(itemKind);

    if (itemUriString === spec.BUILTIN_URI) {
        symbolLabel = 'built-in ' + symbolLabel;
    } else if (itemUriString === spec.MOTOR_URI) {
        symbolLabel = 'motor mnemonic ' + symbolLabel;
    } else if (itemUriString === spec.COUNTER_URI) {
        symbolLabel = 'counter mnemonic ' + symbolLabel;
    } else if (itemUriString === spec.ACTIVE_FILE_URI || itemUriString === documentUriString) {
        symbolLabel = symbolLabel + ' defined in this file';
    } else {
        const itemUri = vscode.Uri.parse(itemUriString);
        if (itemUri.scheme === 'file') {
            itemUriLabel = vscode.workspace.asRelativePath(itemUri);
            symbolLabel = outputsMarkdown ? 'user-defined ' + symbolLabel : symbolLabel + ' defined in ' + itemUriLabel;
        } else {
            itemUriLabel = itemUriString;
            symbolLabel = outputsMarkdown ? 'user-defined ' + symbolLabel : symbolLabel + ' defined in ' + itemUriString;
        }
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

function truncateString(settingKey: string, description?: string, comments?: string): string | undefined {
    const config = vscode.workspace.getConfiguration('vscode-spec.editor.hintVolume');
    const volume = config.get<string>(settingKey, '');
    let truncatedString;
    if (description) {
        if (volume === 'full') {
            truncatedString = description;
        } else if (volume === 'paragraph') {
            const endIndex = description.indexOf('\n\n');
            truncatedString = (endIndex >= 0) ? description.substr(0, endIndex) + '\n\n...' : description;
        } else if (volume === 'sentence') {
            const endIndex = description.search(/\.\s/g);
            truncatedString = (endIndex >= 0) ? description.substr(0, endIndex) + '. ...' : description;
        }
    }

    if (comments) {
        if (volume === 'full' || volume === 'paragraph') {
            truncatedString = (truncatedString) ? truncatedString + '\n\n' + comments : comments;
        }
    }

    return truncatedString;
}

function getParameterInformation(signature: string): vscode.ParameterInformation[] | undefined {
    const parStart = signature.indexOf('(');
    const parEnd = signature.lastIndexOf(')');
    if (parStart < 0 || parEnd < 0) {
        return undefined;
    }
    // const selectorName = signature.substring(0, parStart).trim();
    const argumentList = signature.substring(parStart + 1, parEnd).replace(/[[\]]/g, '').split(',');
    return argumentList.map(argStr => new vscode.ParameterInformation(argStr.trim()));
}

function parseSignatureInEditing(line: string, position: number) {
    let substr = line.substring(0, position);

    // flatten paired parentheses:
    // from "parentfunc(sonfunc(a, b, c), daughterFunc(d, e"
    // to   "parentfunc(sonfunc_________, daughterFunc(d, e"
    for (;;) {
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
export class Provider implements vscode.CompletionItemProvider, vscode.HoverProvider, vscode.SignatureHelpProvider {

    // vscode.Uri objects can not be used as a key for a Map object because these 
    // objects having the same string representation can be recognized different,
    // i.e., uriA.toString() === uriB.toString() but uriA !== uriB.
    // This is mainly caused by the difference in their minor properties, such as fsPath
    // (File System Path). To avoid this problem, the string representation of a Uri 
    // object is used as a key.

    protected readonly storageCollection = new Map<string, spec.ReferenceStorage>();
    protected readonly completionItemCollection = new Map<string, vscode.CompletionItem[]>();

    constructor(context: vscode.ExtensionContext) {
        // register providers
        context.subscriptions.push(
            vscode.languages.registerCompletionItemProvider(spec.SELECTOR, this),
            vscode.languages.registerSignatureHelpProvider(spec.SELECTOR, this, '(', ')', ','),
            vscode.languages.registerHoverProvider(spec.SELECTOR, this),
        );
    }

    /**
     * Generate completion items from the registered storage and cache it in the map using `uri` as the key.
     * Subclass must invoke it when the storage contents are changed. 
     */
    protected updateCompletionItemsForUriString(uriString: string) : vscode.CompletionItem[] | undefined {
        const storage = this.storageCollection.get(uriString);
        if (storage) {
            const completionItems: vscode.CompletionItem[] = [];
            for (const [itemKind, map] of storage.entries()) {
                const completionItemKind = spec.getCompletionItemKindFromReferenceItemKind(itemKind);
                for (const [identifier, item] of map.entries()) {
                    const completionItem = new vscode.CompletionItem(identifier, completionItemKind);
                    // embed `uriString` into `detail` property in order to resolve it later efficiently.
                    completionItem.detail = uriString;
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
    public provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.CompletionItem[] | undefined {
        if (token.isCancellationRequested) { return; }

        const range = document.getWordRangeAtPosition(position);
        if (range === undefined) { return; }

        const selectorName = document.getText(range);
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(selectorName)) { return; }

        const aggregatedCompletionItems: vscode.CompletionItem[] = [];
        for (const completionItems of this.completionItemCollection.values()) {
            aggregatedCompletionItems.push(...completionItems);
        }
        return aggregatedCompletionItems;
    }

    /**
     * Optional implementation of vscode.CompletionItemProvider
     */
    public resolveCompletionItem(completionItem: vscode.CompletionItem, token: vscode.CancellationToken): vscode.CompletionItem | undefined {
        if (token.isCancellationRequested) { return; }

        // The URI is stored in `detail` property in unresolved completion item.
        const itemKind = spec.getReferenceItemKindFromCompletionItemKind(completionItem.kind);
        const refUriString = completionItem.detail;
        if (refUriString === undefined) { return; }

        const storage = this.storageCollection.get(refUriString);
        if (storage === undefined) { return; }

        const activeEditor = vscode.window.activeTextEditor;
        const documentUriString = (activeEditor) ? activeEditor.document.uri.toString() : '';
        const map = storage.get(itemKind);
        if (map === undefined) { return; }

        // find the symbol information about the symbol.
        const item = map.get(completionItem.label);
        if (item === undefined) { return; }

        // copy completion item.
        const newCompletionItem = Object.assign({}, completionItem);

        // set the detail of the completion item
        newCompletionItem.detail = getShortDescription(item, itemKind, refUriString, documentUriString, false);

        // set the description of the completion item
        // if the main description exists, append it.
        
        const descriptionMarkdown = new vscode.MarkdownString(truncateString('completionItem', item.description, item.comments));

        // if overloaded signature exists, append them.
        if (item.overloads) {
            for (const overload of item.overloads) {
                // descriptionMarkdown.appendMarkdown('---');
                descriptionMarkdown.appendCodeblock(overload.signature);
                const truncatedString = truncateString('completionItem', overload.description, undefined);
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
    public provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.Hover | undefined {
        if (token.isCancellationRequested) { return; }

        const range = document.getWordRangeAtPosition(position);
        if (range === undefined) { return; }

        const selectorName = document.getText(range);
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(selectorName)) { return; }

        // start to seek if the selection is a proper identifier.
        let hover: vscode.Hover | undefined;

        for (const [refUriString, storage] of this.storageCollection.entries()) {
            for (const [itemKind, map] of storage.entries()) {
                // find the symbol information about the symbol.
                const item = map.get(selectorName);
                if (item) {
                    let mainMarkdown = getShortDescription(item, itemKind, refUriString, document.uri.toString(), true);

                    // prepare the second line: the description (if it exists)
                    const truncatedString = truncateString('hover', item.description, item.comments);
                    if (truncatedString) {
                        mainMarkdown = mainMarkdown.appendMarkdown(truncatedString);
                    }

                    if (!hover) {
                        hover = new vscode.Hover(mainMarkdown);
                    } else {
                        hover.contents.push(mainMarkdown);
                    }

                    // for overloaded functions, prepare additional markdown blocks
                    if (item.overloads) {
                        for (const overload of item.overloads) {
                            let overloadMarkdown = new vscode.MarkdownString().appendCodeblock(overload.signature);
                            const truncatedString2 = truncateString('hover', overload.description, undefined);
                            if (truncatedString2) {
                                overloadMarkdown = overloadMarkdown.appendMarkdown(truncatedString2);
                            }
                            hover.contents.push(overloadMarkdown);
                        }
                    }
                    // return hover;
                }
            }
        }
        return hover;
    }

    /**
     * Required implementation of vscode.SignatureHelpProvider
     */
    public provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.SignatureHelpContext): vscode.SignatureHelp | undefined {
        if (token.isCancellationRequested) { return; }

        const signatureHint = parseSignatureInEditing(document.lineAt(position.line).text, position.character);
        if (signatureHint === undefined) { return; }

        for (const storage of this.storageCollection.values()) {
            const map = storage.get(spec.ReferenceItemKind.Function);
            let item: spec.ReferenceItem | undefined;
            if (map && (item = map.get(signatureHint.signature)) !== undefined) {
                const overloads = (item.overloads) ? item.overloads : [{ signature: item.signature, description: item.description }];
                const signatureHelp = new vscode.SignatureHelp();

                for (const overload of overloads) {
                    // assume that usage.signature must exist.
                    const signatureInformation = new vscode.SignatureInformation(overload.signature);
                    const truncatedString = truncateString('signatureHelp', overload.description, undefined);
                    if (truncatedString) {
                        signatureInformation.documentation = new vscode.MarkdownString(truncatedString);
                    }
                    let parameters: vscode.ParameterInformation[] | undefined;
                    if ((parameters = getParameterInformation(overload.signature)) !== undefined) {
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
