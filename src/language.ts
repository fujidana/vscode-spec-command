import * as vscode from 'vscode';
import type { LocationRange, Location } from './parser';
import type * as tree from './tree';

export const SELECTOR = { language: 'spec-command' };
// export const SELECTOR = [{ scheme: 'file', language: 'spec-command' }, { scheme: 'untitled', language: 'spec-command' }];
export const BUILTIN_URI = 'spec-command://built-in/built-in.md';
export const EXTERNAL_URI = 'spec-command://built-in/external.md';
export const MOTOR_URI = 'spec-command://built-in/mnemonic-motor.md';
export const COUNTER_URI = 'spec-command://built-in/mnemonic-counter.md';
export const SNIPPET_URI = 'spec-command://built-in/code-snippet.md';
export const ACTIVE_FILE_URI = 'spec-command://file/active-document.md';
export const AST_URI = 'spec-command://file/ast.json';

export function convertPosition(position: Location): vscode.Position {
    return new vscode.Position(position.line - 1, position.column - 1);
}

export function convertRange(range: LocationRange): vscode.Range {
    return new vscode.Range(convertPosition(range.start), convertPosition(range.end));
}

export type ParsedData = { refBook: ReferenceBook };
export type ParsedFileData = { refBook: ReferenceBook, tree?: tree.Program, symbols?: vscode.DocumentSymbol[], diagnostics?: vscode.Diagnostic[] };

export type UpdateSession<T extends ParsedData = ParsedData> = { promise: Promise<T | undefined> };
export type FileUpdateSession = { promise: Promise<ParsedFileData | undefined>, tokenSource?: vscode.CancellationTokenSource | undefined, tokenSource1?: vscode.CancellationTokenSource | undefined };


/**
 * Map object consisting of pairs of a unique identifier and a reference item.
 */
export type ReferenceBook = Map<string, ReferenceItem>;

// 'overloads' parameter is used only by built-in macros and functions.
export type ReferenceItem = {
    readonly signature: string;
    readonly category: ReferenceCategory;
    readonly description?: string;
    readonly available?: VersionRange;
    readonly deprecated?: VersionRange;
    readonly snippet?: string;
    readonly location?: LocationRange;
    readonly overloads?: {
        readonly signature: string;
        readonly description?: string;
    }[];
};

export type VersionRange = {
    readonly range: string;
    readonly description?: string;
};

const referenceCategoryNames = ['undefined', 'constant', 'variable', 'array', 'macro', 'function', 'keyword', 'snippet', 'enum'] as const;

export type ReferenceCategory = typeof referenceCategoryNames[number];

export type ReferenceBookLike = { [K in ReferenceCategory]?: { [key: string]: Omit<ReferenceItem, 'category'> } };

type ReferenceCategoryMetadata = {
    readonly label: string
    readonly iconIdentifier: string,
    readonly completionItemKind: vscode.CompletionItemKind | undefined,
    readonly symbolKind: vscode.SymbolKind,
};

export function getVersionRangeDescription(versionRange: VersionRange, label: string) {
    let tmpStr = versionRange.range === '>=0.0.0' ? `[${label} at some time]` : `[${label}: \`${versionRange.range}\`]`;
    if (versionRange.description) {
        tmpStr += ' ' + versionRange.description;
    }
    return tmpStr;
}

export const referenceCategoryMetadata: { readonly [K in ReferenceCategory]: ReferenceCategoryMetadata } = {
    constant: {
        label: 'constant',
        iconIdentifier: 'symbol-constant',
        completionItemKind: vscode.CompletionItemKind.Constant,
        symbolKind: vscode.SymbolKind.Constant
    },
    variable: {
        label: 'variable',
        iconIdentifier: 'symbol-variable',
        completionItemKind: vscode.CompletionItemKind.Variable,
        symbolKind: vscode.SymbolKind.Variable
    },
    array: {
        label: 'data-array',
        iconIdentifier: 'symbol-array',
        completionItemKind: vscode.CompletionItemKind.Variable,
        symbolKind: vscode.SymbolKind.Array
    },
    macro: {
        label: 'macro',
        iconIdentifier: 'symbol-module',
        completionItemKind: vscode.CompletionItemKind.Module,
        symbolKind: vscode.SymbolKind.Module
    },
    function: {
        label: 'function',
        iconIdentifier: 'symbol-function',
        completionItemKind: vscode.CompletionItemKind.Function,
        symbolKind: vscode.SymbolKind.Function
    },
    keyword: {
        label: 'keyword',
        iconIdentifier: 'symbol-keyword',
        completionItemKind: vscode.CompletionItemKind.Keyword,
        symbolKind: vscode.SymbolKind.Null // no corresponding value
    },
    snippet: {
        label: 'snippet',
        iconIdentifier: 'symbol-snippet',
        completionItemKind: vscode.CompletionItemKind.Snippet,
        symbolKind: vscode.SymbolKind.Null // no corresponding value
    },
    enum: {
        label: 'member',
        iconIdentifier: 'symbol-enum-member',
        completionItemKind: vscode.CompletionItemKind.EnumMember,
        symbolKind: vscode.SymbolKind.EnumMember
    },
    undefined: {
        label: 'unknown symbol',
        iconIdentifier: 'symbol-null',
        completionItemKind: undefined,
        symbolKind: vscode.SymbolKind.Null
    }
};

export class CompletionItem extends vscode.CompletionItem {
    readonly uriString: string;
    readonly category: ReferenceCategory;

    constructor(label: string | vscode.CompletionItemLabel, uriString: string, category: ReferenceCategory) {
        super(label, referenceCategoryMetadata[category].completionItemKind);
        this.uriString = uriString;
        this.category = category;
    };
}

export const defaultDiagnosticRules = {
    'no-local-outside-block': false,
    'no-undeclared-variable': false,
    'no-undeclared-macro-argument': false,
};

export type DiagnosticRules = typeof defaultDiagnosticRules;

/**
 * Convert a flattened map object to a structured database made of a plain object.
 * @param refBook Map object directly containing reference items.
 * @returns Object having categories as childrens and reference items as grandchildren.
 */
export function categorizeRefBook(refBook: ReferenceBook, categories: readonly ReferenceCategory[] = referenceCategoryNames) {
    const refBookLike: ReferenceBookLike = {};
    for (const category of categories) {
        refBookLike[category] = {};
    }

    for (const [identifier, refItem] of refBook.entries()) {
        if (categories.includes(refItem.category)) {
            const refBookCategory = refBookLike[refItem.category];
            if (refBookCategory) {
                // // Simply point (not copy) without deleting "category" property.
                // refBookCategory[identifier] = refItem;
                // Copy a new object with "category" property removed. 
                refBookCategory[identifier] = (({ category, ...rest }) => rest)(refItem);
            }
        }
    }
    return refBookLike;
}

/**
 * Convert a structured database made of a plain object to flattened map object.
 * @param refBookLike Object having categories as childrens and reference items as grandchildren.
 * @param categories Categories to be converted.
 * @returns Map object directly containing reference items.
 */
export function flattenRefBook(refBookLike: ReferenceBookLike, categories: readonly ReferenceCategory[] = referenceCategoryNames): ReferenceBook {
    const refBook: ReferenceBook = new Map();
    for (const [category, refSheetLike] of Object.entries(refBookLike)) {
        if (categories.includes(category as keyof typeof refBookLike)) {
            for (const [identifier, refItemLike] of Object.entries(refSheetLike)) {
                // if (refBook.has(identifier)) {
                //     console.log(`Identifiers are duplicated!: ${identifier}`);
                // }
                const refItem: ReferenceItem = Object.assign(refItemLike, { category: category as keyof typeof refBookLike });
                refBook.set(identifier, refItem);
            }
        }
    }
    return refBook;
}
