import * as vscode from 'vscode';
import * as lang from './language';
import { SemVer, satisfies } from 'semver';

const suppressMessagesConfig = {
    'completionItem.label.detail': false,
    'completionItem.label.description': false,
    'completionItem.documentation': false,
    'signatureHelp.signatures.documentation': false,
    'hover.contents': false
};

type SuppressMessagesConfig = Partial<typeof suppressMessagesConfig>;

function getShortDescription(item: lang.ReferenceItem, category: lang.ReferenceCategory, itemUriString: string, documentUriString: string, markdownFormat: boolean): string {
    let symbolLabel: string;
    let itemUriLabel: string | undefined;

    symbolLabel = lang.referenceCategoryMetadata[category].label;

    if (itemUriString === lang.BUILTIN_URI) {
        symbolLabel = 'built-in ' + symbolLabel;
    } else if (itemUriString === lang.EXTERNAL_URI) {
        symbolLabel = 'external ' + symbolLabel;
    } else if (itemUriString === lang.MOTOR_URI) {
        symbolLabel = 'motor mnemonic ' + symbolLabel;
    } else if (itemUriString === lang.COUNTER_URI) {
        symbolLabel = 'counter mnemonic ' + symbolLabel;
    } else if (itemUriString === lang.SNIPPET_URI) {
        symbolLabel = 'counter/motor ' + symbolLabel;
    } else if (itemUriString === lang.ACTIVE_FILE_URI || itemUriString === documentUriString) {
        if (item.location) {
            symbolLabel = `${symbolLabel} defined at l.${item.location.start.line} in this file `;
        } else {
            symbolLabel = symbolLabel + ' defined in this file';
        }
    } else {
        // const itemUri = vscode.Uri.parse(itemUriString);
        // itemUriLabel = (itemUri.scheme === 'file') ? vscode.workspace.asRelativePath(itemUri) : itemUriString;
        itemUriLabel = vscode.workspace.asRelativePath(vscode.Uri.parse(itemUriString));
        symbolLabel = markdownFormat ? 'user-defined ' + symbolLabel : symbolLabel + ' defined in ' + itemUriLabel;
    }

    let mainText = `${item.signature} # ${symbolLabel}`;
    if (item.overloads && item.overloads.length > 1) {
        mainText += `, ${item.overloads.length} overloads`;
    }

    if (markdownFormat) {
        mainText = '```\n' + mainText + '\n```\n\n';
        if (itemUriLabel) {
            mainText += `_defined in_ [${itemUriLabel}](${itemUriString}).\n\n`;
        }
    }
    return mainText;
}

const enum TruncationLevel {
    full = 0,
    paragraph,
    line
}

function truncateString(level: TruncationLevel, item: { description?: string, deprecated?: lang.VersionRange, available?: lang.VersionRange }): string | undefined {
    let truncatedString;
    if (item.description) {
        if (level === TruncationLevel.full) {
            truncatedString = item.description;
        } else if (level === TruncationLevel.paragraph) {
            const endIndex = item.description.indexOf('\n\n');
            truncatedString = (endIndex >= 0) ? item.description.substring(0, endIndex) + '\n\n...' : item.description;
        } else if (level === TruncationLevel.line) {
            const endIndex = item.description.search(/\.\s/g);
            truncatedString = (endIndex >= 0) ? item.description.substring(0, endIndex) + '. ...' : item.description;
        }
    }

    if (level !== TruncationLevel.line) {
        if (item.available) {
            const tmpStr = lang.getVersionRangeDescription(item.available, 'available');
            truncatedString = truncatedString ? truncatedString + '\n\n' + tmpStr : tmpStr;
        }

        if (item.deprecated) {
            const tmpStr = lang.getVersionRangeDescription(item.deprecated, 'deprecated');
            truncatedString = truncatedString ? truncatedString + '\n\n' + tmpStr : tmpStr;
        }
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
 * Abstract class for a main controller.
 */
export class Controller implements vscode.CompletionItemProvider<lang.CompletionItem>, vscode.HoverProvider, vscode.SignatureHelpProvider {

    // In JavaScript, equality comparison (`==` and `===`) of two different objects
    // is always `false`, regardless of the equality of their values.
    // Therefore, the string representation of the Uri object is used in the extension.
    // String is a primitive type and thus, the equality comparision is based on the value.

    public readonly referenceCollection = new Map<string, lang.ReferenceBook>();
    protected readonly completionItemCollection = new Map<string, lang.CompletionItem[]>();
    protected specVersion: SemVer;

    constructor(context: vscode.ExtensionContext) {
        this.specVersion = new SemVer(vscode.workspace.getConfiguration('spec-command').get<string>('specVersion', '6.13.4'));

        const configurationDidChangeListener = (event: vscode.ConfigurationChangeEvent) => {
            if (event.affectsConfiguration('spec-command.suggest.suppressMessages')) {
                for (const uriString of this.referenceCollection.keys()) {
                    this.updateCompletionItemsForUriString(uriString);
                }
            }
            if (event.affectsConfiguration('spec-command.specVersion')) {
                this.specVersion = new SemVer(vscode.workspace.getConfiguration('spec-command').get<string>('specVersion', '6.13.4'));
                for (const uriString of this.referenceCollection.keys()) {
                    this.updateCompletionItemsForUriString(uriString);
                }
            }
        };

        // Register providers and event handlers.
        context.subscriptions.push(
            vscode.languages.registerCompletionItemProvider(lang.SELECTOR, this),
            vscode.languages.registerHoverProvider(lang.SELECTOR, this),
            vscode.languages.registerSignatureHelpProvider(lang.SELECTOR, this, '(', ')', ','),
            vscode.workspace.onDidChangeConfiguration(configurationDidChangeListener),
        );
    }

    /**
     * Generate completion items from the registered database and cache it in the map using `uri` as the key.
     * Subclass must invoke it when the database contents are changed.
     */
    protected updateCompletionItemsForUriString(uriString: string): lang.CompletionItem[] | undefined {
        const refBook = this.referenceCollection.get(uriString);
        if (refBook) {
            const config = vscode.workspace.getConfiguration('spec-command.suggest').get<SuppressMessagesConfig>('suppressMessages', suppressMessagesConfig);
            const suppressDetail = config['completionItem.label.detail'] ?? false;
            const suppressDescription = config['completionItem.label.description'] ?? false;
            let description: string | undefined;

            if (!suppressDescription) {
                if (uriString === lang.BUILTIN_URI) {
                    description = 'built-in';
                } else if (uriString === lang.EXTERNAL_URI) {
                    description = 'external';
                } else if (uriString === lang.MOTOR_URI) {
                    description = 'motor';
                } else if (uriString === lang.COUNTER_URI) {
                    description = 'counter';
                } else if (uriString === lang.SNIPPET_URI) {
                    description = 'snippet';
                } else if (uriString === lang.ACTIVE_FILE_URI) {
                    // } else if (uriString === spec.ACTIVE_FILE_URI || uriString === vscode.window.activeTextEditor?.document.uri.toString()) {
                    description = 'local';
                } else {
                    // description = (itemUri.scheme === 'file') ? vscode.workspace.asRelativePath(vscode.Uri.parse(uriString)) : uriString;
                    description = vscode.workspace.asRelativePath(vscode.Uri.parse(uriString));
                }
            }

            const completionItems: lang.CompletionItem[] = [];
            for (const [identifier, refItem] of refBook.entries()) {
                if (refItem.available && !satisfies(this.specVersion, refItem.available.range)) {
                    // Skip items unavailable in the specified spec version.
                    continue;
                }
                const detail = (!suppressDetail && refItem.signature.startsWith(identifier)) ? refItem.signature.substring(identifier.length) : undefined;
                const label: vscode.CompletionItemLabel = { label: identifier, detail: detail, description: description };
                const completionItem = new lang.CompletionItem(label, uriString, refItem.category);
                if (refItem.snippet) {
                    completionItem.insertText = new vscode.SnippetString(refItem.snippet);
                }
                if (refItem.deprecated && satisfies(this.specVersion, refItem.deprecated.range)) {
                    // Add "Deprecated" tag to the completion item.
                    completionItem.tags = [vscode.CompletionItemTag.Deprecated];
                }
                completionItems.push(completionItem);
            }
            this.completionItemCollection.set(uriString, completionItems);
            return completionItems;
        } else {
            this.completionItemCollection.delete(uriString);
            return undefined;
        }
    }

    /**
     * Required implementation of vscode.CompletionItemProvider.
     */
    public provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.ProviderResult<vscode.CompletionList<lang.CompletionItem> | lang.CompletionItem[]> {
        if (token.isCancellationRequested) { return; }

        const range = document.getWordRangeAtPosition(position);
        if (range === undefined) { return; }

        const selectorName = document.getText(range);
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(selectorName)) { return; }

        return new Array<lang.CompletionItem>().concat(...this.completionItemCollection.values());
    }

    /**
     * Optional implementation of vscode.CompletionItemProvider.
     */
    public resolveCompletionItem(completionItem: lang.CompletionItem, token: vscode.CancellationToken): vscode.ProviderResult<lang.CompletionItem> {
        if (token.isCancellationRequested) { return; }

        const category = completionItem.category;
        const refUriString = completionItem.uriString;

        const activeEditor = vscode.window.activeTextEditor;
        const documentUriString = activeEditor ? activeEditor.document.uri.toString() : '';

        const config = vscode.workspace.getConfiguration('spec-command.suggest').get<SuppressMessagesConfig>('suppressMessages', suppressMessagesConfig);
        const truncationlevel = config['completionItem.documentation'] === true ? TruncationLevel.line : TruncationLevel.paragraph;

        // find the symbol information about the symbol.
        const label = typeof completionItem.label === 'string' ? completionItem.label : completionItem.label.label;
        const refItem = this.referenceCollection.get(refUriString)?.get(label);
        if (refItem === undefined) { return; }

        // copy completion item.
        const newCompletionItem = Object.assign({}, completionItem);

        // set the description of the completion item
        // if the main description exists, append it.

        const documentation = new vscode.MarkdownString(truncateString(truncationlevel, refItem));

        // if overloaded signature exists, append them.
        if (refItem.overloads) {
            for (const overload of refItem.overloads) {
                // documentation.appendMarkdown('---');
                documentation.appendCodeblock(overload.signature);
                const truncatedString = truncateString(truncationlevel, overload);
                if (truncatedString) {
                    documentation.appendMarkdown(truncatedString);
                }
            }
        }

        // set the detail of the completion item
        newCompletionItem.detail = getShortDescription(refItem, category, refUriString, documentUriString, false);
        newCompletionItem.documentation = documentation;

        return newCompletionItem;
    }

    /**
     * Required implementation of vscode.HoverProvider.
     */
    public provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Hover> {
        if (token.isCancellationRequested) { return; }

        const config = vscode.workspace.getConfiguration('spec-command.suggest').get<SuppressMessagesConfig>('suppressMessages', suppressMessagesConfig);
        const truncationLevel = config['hover.contents'] === true ? TruncationLevel.paragraph : TruncationLevel.full;

        const range = document.getWordRangeAtPosition(position);
        if (range === undefined) { return; }

        const selectorName = document.getText(range);
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(selectorName)) { return; }

        // start to seek if the selection is a proper identifier.
        const contents: vscode.MarkdownString[] = [];

        for (const [uriString, refBook] of this.referenceCollection.entries()) {
            // find the symbol information about the symbol.
            const refItem = refBook.get(selectorName);
            if (refItem) {
                let mainMarkdown = new vscode.MarkdownString(getShortDescription(refItem, refItem.category, uriString, document.uri.toString(), true));

                // prepare the second line: the description (if it exists)
                const truncatedString = truncateString(truncationLevel, refItem);
                if (truncatedString) {
                    mainMarkdown = mainMarkdown.appendMarkdown(truncatedString);
                }
                contents.push(mainMarkdown);

                // for overloaded functions, prepare additional markdown blocks
                if (refItem.overloads) {
                    for (const overload of refItem.overloads) {
                        let overloadMarkdown = new vscode.MarkdownString().appendCodeblock(overload.signature);
                        const truncatedString2 = truncateString(truncationLevel, overload);
                        if (truncatedString2) {
                            overloadMarkdown = overloadMarkdown.appendMarkdown(truncatedString2);
                        }
                        contents.push(overloadMarkdown);
                    }
                }
            }
        }
        return contents.length > 0 ? new vscode.Hover(contents) : undefined;
    }

    /**
     * Required implementation of vscode.SignatureHelpProvider.
     */
    public provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.SignatureHelpContext): vscode.ProviderResult<vscode.SignatureHelp> {
        if (token.isCancellationRequested) { return; }

        const signatureHint = parseSignatureInEditing(document.lineAt(position.line).text, position.character);
        if (signatureHint === undefined) { return; }

        const config = vscode.workspace.getConfiguration('spec-command.suggest').get<SuppressMessagesConfig>('suppressMessages', suppressMessagesConfig);
        const truncationLevel = config['signatureHelp.signatures.documentation'] === true ? TruncationLevel.paragraph : TruncationLevel.full;

        for (const refBook of this.referenceCollection.values()) {
            let refItem: lang.ReferenceItem | undefined;
            if ((refItem = refBook.get(signatureHint.signature)) !== undefined && refItem.category === 'function') {
                const signatureHelp = new vscode.SignatureHelp();
                const overloads = refItem.overloads ?? [{ signature: refItem.signature, description: refItem.description }];

                for (const overload of overloads) {
                    // assume that usage.signature must exist.
                    const signatureInformation = new vscode.SignatureInformation(overload.signature);
                    const truncatedString = truncateString(truncationLevel, overload);
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
