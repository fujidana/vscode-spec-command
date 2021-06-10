import * as vscode from 'vscode';

const LOG_SELECTOR = [{ scheme: 'file', language: 'spec-log' }, { scheme: 'untitled', language: 'spec-log' }];

/**
 * Provider class
 */
export class LogProvider implements vscode.FoldingRangeProvider, vscode.DocumentSymbolProvider {

    // vscode.Uri objects can not be used as a key for a Map object because these 
    // objects having the same string representation can be recognized different,
    // i.e., uriA.toString() === uriB.toString() but uriA !== uriB.
    // This is mainly caused by the difference in their minor properties, such as fsPath
    // (File System Path). To avoid this problem, the string representation of a Uri 
    // object is used as a key.

    constructor(context: vscode.ExtensionContext) {
        // register providers
        context.subscriptions.push(
            vscode.languages.registerFoldingRangeProvider(LOG_SELECTOR, this),
            vscode.languages.registerDocumentSymbolProvider(LOG_SELECTOR, this),
        );
    }

    /**
     * Required implementation of vscode.FoldingRangeProvider
     */
     public provideFoldingRanges(document: vscode.TextDocument, context: vscode.FoldingContext, token: vscode.CancellationToken): vscode.ProviderResult<vscode.FoldingRange[]> {
        if (token.isCancellationRequested) { return; }

        const lineCount = document.lineCount;
        const regexp = /^([0-9]+\.[A-Z][A-Z0-9]*>)\s+(.*)\s*$/;
        const ranges: vscode.FoldingRange[] = [];
        let lineAtPrompt = 0;

        for (let index = 0; index < lineCount; index++) {
            if (document.lineAt(index).text.match(regexp)) {
                ranges.push(new vscode.FoldingRange(lineAtPrompt, index - 1));
                lineAtPrompt = index;
            }
        }
        if (lineAtPrompt !== 0) {
            ranges.push(new vscode.FoldingRange(lineAtPrompt, lineCount - 1));
        }
        return ranges;
    }

    /**
     * Required implementation of vscode.DocumentSymbolProvider
     */
     public provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.SymbolInformation[] | vscode.DocumentSymbol[]> {
        if (token.isCancellationRequested) { return; }

        const lineCount = document.lineCount;
        const regexp = /^([0-9]+\.[A-Z][A-Z0-9]*>)\s+(.*)\s*$/;
        const results: vscode.DocumentSymbol[] = [];

        for (let index = 0; index < lineCount; index++) {
            const matched = document.lineAt(index).text.match(regexp);
            if (matched) {
                const range = new vscode.Range(index, 0, index, matched[0].length);
                const selectedRange = new vscode.Range(index, 0, index, matched[2].length);
                results.push(new vscode.DocumentSymbol(matched[1], matched[2], vscode.SymbolKind.Key, range, selectedRange));
            }
        }
        return results;
    }
}