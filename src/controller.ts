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

const enum TruncationLevel {
    full = 0,
    paragraph,
    line
}

function truncateString(level: TruncationLevel, item: { description?: string, deprecated?: lang.VersionRange, available?: lang.VersionRange }): string | undefined {
    let truncatedString: string | undefined;
    if (item.description) {
        if (level === TruncationLevel.full) {
            truncatedString = item.description;
        } else if (level === TruncationLevel.paragraph) {
            const endIndex = item.description.indexOf('\n\n');
            truncatedString = (endIndex >= 0) ? item.description.substring(0, endIndex) + '\n\n...' : item.description;
        } else if (level === TruncationLevel.line) {
            const endIndex = item.description.search(/\.\s|\n\n/);
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
export class Controller<T extends lang.UpdateSession> implements vscode.CompletionItemProvider<lang.CompletionItem>, vscode.HoverProvider, vscode.SignatureHelpProvider {

    // In JavaScript, equality comparison (`==` and `===`) of two different objects
    // is always `false`, regardless of the equality of their values.
    // Therefore, the string representation of the Uri object is used in the extension.
    // String is a primitive type and thus, the equality comparision is based on the value.

    public readonly updateSessionMap: Map<string, T> = new Map();
    protected specVersion: SemVer;

    constructor(context: vscode.ExtensionContext) {
        this.specVersion = new SemVer(vscode.workspace.getConfiguration('spec-command').get<string>('specVersion', '6.13.4'));

        const configurationDidChangeListener = (event: vscode.ConfigurationChangeEvent) => {
            if (event.affectsConfiguration('spec-command.specVersion')) {
                this.specVersion = new SemVer(vscode.workspace.getConfiguration('spec-command').get<string>('specVersion', '6.13.4'));
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
     * Required implementation of vscode.CompletionItemProvider.
     */
    public async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): Promise<vscode.CompletionList<lang.CompletionItem> | lang.CompletionItem[] | undefined> {
        if (token.isCancellationRequested) { return; }

        const range = document.getWordRangeAtPosition(position);
        if (range === undefined) { return; }

        const selectorName = document.getText(range);
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(selectorName)) { return; }

        const config = vscode.workspace.getConfiguration('spec-command.suggest').get<SuppressMessagesConfig>('suppressMessages', suppressMessagesConfig);
        const suppressDetail = config['completionItem.label.detail'] ?? false;
        const suppressDescription = config['completionItem.label.description'] ?? false;
        const completionItems: lang.CompletionItem[] = [];

        for (const [uriString, session] of this.updateSessionMap) {
            const refBook = (await session.promise)?.refBook;

            // Quit if cancelled and skip if symbol is not found in a file.
            if (token.isCancellationRequested) { return; }
            if (refBook === undefined) { continue; }

            const description = suppressDescription ?
                undefined :
                this.getCompletionItemLabelDescription(uriString);

            for (const [identifier, refItem] of refBook.entries()) {
                // Skip items if unavailable.
                if (refItem.available && !satisfies(this.specVersion, refItem.available.range)) {
                    continue;
                }

                // Create completion item.
                const detail = (!suppressDetail && refItem.signature.startsWith(identifier)) ? refItem.signature.substring(identifier.length) : undefined;
                const label: vscode.CompletionItemLabel = { label: identifier, detail, description };
                const completionItem = new lang.CompletionItem(label, uriString, refItem.category);
                if (refItem.snippet) {
                    completionItem.insertText = new vscode.SnippetString(refItem.snippet);
                }

                // Add "Deprecated" tag if deprecated.
                if (refItem.deprecated && satisfies(this.specVersion, refItem.deprecated.range)) {
                    completionItem.tags = [vscode.CompletionItemTag.Deprecated];
                }

                // Add item to item list.
                completionItems.push(completionItem);
            }
        }
        return completionItems;
    }

    /**
     * Optional implementation of vscode.CompletionItemProvider.
     */
    public async resolveCompletionItem(completionItem: lang.CompletionItem, token: vscode.CancellationToken): Promise<lang.CompletionItem | undefined> {
        if (token.isCancellationRequested) { return; }

        const refUriString = completionItem.uriString;

        const config = vscode.workspace.getConfiguration('spec-command.suggest').get<SuppressMessagesConfig>('suppressMessages', suppressMessagesConfig);
        const truncationlevel = config['completionItem.documentation'] === true ? TruncationLevel.line : TruncationLevel.paragraph;

        // Find the symbol information about the symbol.
        const label = typeof completionItem.label === 'string' ? completionItem.label : completionItem.label.label;
        const refItem = (await this.updateSessionMap.get(refUriString)?.promise)?.refBook.get(label);

        // Quit if cancelled or symbol is not found in the file.
        if (token.isCancellationRequested) { return; }
        if (refItem === undefined) { return; }

        // Set the description of the completion item
        // If the main description exists, append it.
        const documentation = new vscode.MarkdownString(truncateString(truncationlevel, refItem));

        // If overloaded signature exists, append them.
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

        // Copy completion item and update its properties.
        const newCompletionItem = Object.assign({}, completionItem);
        // const activeEditor = vscode.window.activeTextEditor;
        // const isCurrentDocument = activeEditor ? activeEditor.document.uri.toString() === refUriString : false;
        newCompletionItem.detail = this.getSignatureDescription(refItem, refUriString);
        newCompletionItem.documentation = documentation;

        return newCompletionItem;
    }

    // Required implementation of vscode.HoverProvider.
    public async provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Hover | undefined> {
        if (token.isCancellationRequested) { return; }

        const config = vscode.workspace.getConfiguration('spec-command.suggest').get<SuppressMessagesConfig>('suppressMessages', suppressMessagesConfig);
        const truncationLevel = config['hover.contents'] === true ? TruncationLevel.paragraph : TruncationLevel.full;

        const range = document.getWordRangeAtPosition(position);
        if (range === undefined) { return; }

        const selectorName = document.getText(range);
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(selectorName)) { return; }

        // Start to seek if the selection is a proper identifier.
        const contents: vscode.MarkdownString[] = [];

        for (const [uriString, session] of this.updateSessionMap.entries()) {
            const refItem = (await session.promise)?.refBook.get(selectorName);

            // Quit if cancelled and skip if symbol is not found in a file.
            if (token.isCancellationRequested) { return; }
            if (refItem === undefined) { continue; }

            // Create markdown text if symbol is found.
            // const isCurrentDocument = document.uri.toString() === uriString;
            let mainMarkdown = new vscode.MarkdownString().appendCodeblock(this.getSignatureDescription(refItem, uriString));

            const truncatedString = truncateString(truncationLevel, refItem);
            if (truncatedString) {
                mainMarkdown = mainMarkdown.appendMarkdown(truncatedString);
            }
            contents.push(mainMarkdown);

            // For overloaded functions, prepare additional markdown blocks.
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
        return contents.length > 0 ? new vscode.Hover(contents) : undefined;
    }

    /**
     * Required implementation of vscode.SignatureHelpProvider.
     */
    public async provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.SignatureHelpContext): Promise<vscode.SignatureHelp | undefined> {
        if (token.isCancellationRequested) { return; }

        const signatureHint = parseSignatureInEditing(document.lineAt(position.line).text, position.character);
        if (signatureHint === undefined) { return; }

        const config = vscode.workspace.getConfiguration('spec-command.suggest').get<SuppressMessagesConfig>('suppressMessages', suppressMessagesConfig);
        const truncationLevel = config['signatureHelp.signatures.documentation'] === true ? TruncationLevel.paragraph : TruncationLevel.full;

        for (const session of this.updateSessionMap.values()) {
            const refItem = (await session.promise)?.refBook.get(signatureHint.signature);

            // Quit if cancelled and skip if symbol is not found in a file or symbol is not the one for function.
            if (token.isCancellationRequested) { return; }
            if (refItem === undefined || refItem.category !== 'function') { continue; }

            const signatureHelp = new vscode.SignatureHelp();
            const overloads = refItem.overloads ?? [{ signature: refItem.signature, description: refItem.description }];

            for (const overload of overloads) {
                // Assume that usage.signature must exist.
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

    /**
     * Get the description to be shown at the right side of a completion item.
     * The default implementation returns the relative path of the file where the symbol is defined,
     * but it can be overridden to provide custom descriptions.
     */
    protected getCompletionItemLabelDescription(uriString: string): string | undefined {
        return vscode.workspace.asRelativePath(vscode.Uri.parse(uriString));
    }

    /**
     * Get the additional text to be shown on the hover and resolved completion item.
     * The default implementation returns the symbol signature and the file where the symbol is defined, 
     * but it can be overridden to provide custom descriptions.
     */
    protected getSignatureComment(categoryLabel: string, _uriString: string): string {
        return categoryLabel;
        // return `${categoryLabel} defined in ${vscode.workspace.asRelativePath(vscode.Uri.parse(uriString))}`;
    }

    /**
     * Get the description about to be shown on the hover and in the resolved completion item.
     * The default implementation returns the symbol signature and the file where the symbol is defined.
     */
    private getSignatureDescription(item: lang.ReferenceItem, itemUriString: string): string {
        let itemUriLabel: string | undefined;

        const symbolLabel = this.getSignatureComment(lang.referenceCategoryMetadata[item.category].label, itemUriString);

        let mainText = `${item.signature} # ${symbolLabel}`;
        if (item.overloads && item.overloads.length > 1) {
            mainText += `, ${item.overloads.length} overloads`;
        }
        return mainText;
    }
}
