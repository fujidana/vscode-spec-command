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

export interface ParserResult {
    refBook: ReferenceBook
}

export interface FileParserResult extends ParserResult {
    tree?: tree.Program;
    symbols?: vscode.DocumentSymbol[];
    diagnostics?: vscode.Diagnostic[];
}

export interface DictParserResult extends ParserResult {
    identifier: string;
    scope: 'extension' | 'global' | 'workspace';
    name?: string;
    description?: string;
}


export type UpdateSession<T extends ParserResult = ParserResult> = { promise: Promise<T | undefined> };
export type FileUpdateSession = { promise: Promise<FileParserResult | undefined>, tokenSource?: vscode.CancellationTokenSource | undefined, tokenSource1?: vscode.CancellationTokenSource | undefined };


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

export type CategorizedDictionary = {
    readonly identifier: string;
    readonly scope: 'extension' | 'global' | 'workspace';
    readonly name?: string;
    readonly description?: string;
    readonly categories: {
        [K in ReferenceCategory]?: { [key: string]: Omit<ReferenceItem, 'category'> }
    };
};

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
 * Convert a `Map` object the extension internally uses to a plain object that can be exported after `JSON.stringify()`.
 * @param parserResult Object containing a Map object and some other properties.
 * @param categoryFilters Categories to be converted. Only listed categories will be included in the output object. If not specified, all categories will be included.
 * @returns Stringifiable object that has the `categories` proprties. To access an entry of the dictionary (a leaf of the object tree), do like the following: `obj.categories.function.sock_par`.
 */
export function convertToCategorizedDictionary(parserResult: DictParserResult, categoryFilters: readonly ReferenceCategory[] = referenceCategoryNames): CategorizedDictionary {
    const categories: CategorizedDictionary['categories'] = {};
    for (const categoryName of categoryFilters) {
        categories[categoryName] = {};
    }

    for (const [identifier, entry] of parserResult.refBook.entries()) {
        if (categoryFilters.includes(entry.category)) {
            const dictionaryCategory = categories[entry.category];
            if (dictionaryCategory) {
                // Copy a new object with "category" property removed. 
                dictionaryCategory[identifier] = (({ category, ...rest }) => rest)(entry);
            }
        }
    }
    return {
        identifier: parserResult.identifier,
        scope: parserResult.scope,
        name: parserResult.name,
        description: parserResult.description,
        categories: categories
    } satisfies CategorizedDictionary;
}

/**
 * Convert a plain object that can be imported from file via `JSON.parse()` to a `Map` object the extension internally uses.
 * @param dictionary Object typically parsed from a JSON file, where reference items are categorized under `categories` property.
 * @param categoryFilters Categories to be converted. Only listed categories will be included in the output object. If not specified, all categories will be included.
 * @returns Object containing a Map object and some other properties.
 */
export function convertFromCategorizedDictionary(dictionary: CategorizedDictionary, categoryFilters: readonly ReferenceCategory[] = referenceCategoryNames): DictParserResult {
    const refBook: ReferenceBook = new Map();
    for (const [categoryName, entries] of Object.entries(dictionary.categories)) {
        if (categoryFilters.includes(categoryName as keyof typeof dictionary.categories)) {
            for (const [identifier, entry] of Object.entries(entries)) {
                // if (refBook.has(identifier)) {
                //     console.log(`Identifiers are duplicated!: ${identifier}`);
                // }
                const refItem: ReferenceItem = Object.assign(entry, { category: categoryName as keyof typeof dictionary.categories });
                refBook.set(identifier, refItem);
            }
        }
    }
    return {
        identifier: dictionary.identifier,
        scope: dictionary.scope,
        name: dictionary.name,
        description: dictionary.description,
        refBook,
    };
}
