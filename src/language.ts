import * as vscode from 'vscode';
import type { LocationRange, Location } from './parser';
import type * as tree from './tree';

export const SELECTOR = { language: 'spec-command' };
// export const SELECTOR = [{ scheme: 'file', language: 'spec-command' }, { scheme: 'untitled', language: 'spec-command' }];

export const ACTIVE_FILE_URI = 'spec-command:extension/file/active-document.md';

export const SCDICT_SCHEMA_URI = 'https://raw.githubusercontent.com/fujidana/vscode-spec-command/refs/heads/master/schema/scdict.schema.json';

export function convertPosition(location: Location): vscode.Position {
    return new vscode.Position(location.line - 1, location.column - 1);
}

export function convertRange(range: LocationRange): vscode.Range {
    return new vscode.Range(convertPosition(range.start), convertPosition(range.end));
}

export interface ParserResult {
    refBook: ReferenceBook;
}

export interface FileParserResult extends ParserResult {
    tree?: tree.Program;
    symbols?: vscode.DocumentSymbol[];
    diagnostics?: vscode.Diagnostic[];
}

export interface DictParserResult extends ParserResult {
    identifier: string;
    scope: 'extension' | 'global' | 'workspace';
    $schema?: string;
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

/**
 * A dictionary that holds entries in a categorized manner.
 * The structure of this type is the same as the JSON schema the extension provides and thus
 * the object of this type is serialized and deserialized to and from JSON file.
 */
export type CategorizedDictionary = {
    readonly $schema?: string;
    readonly kind: 'spec-command.dictionary';
    readonly identifier: string;
    readonly scope: 'extension' | 'global' | 'workspace';
    readonly name?: string;
    readonly description?: string;
    readonly categories: {
        [K in ReferenceCategory]?: { [key: string]: Omit<ReferenceItem, 'category'> }
    };
};

export function getVersionRangeDescription(versionRange: VersionRange, label: string) {
    let tmpStr = versionRange.range === '>=0.0.0' ? `[${label} at some time]` : `[${label}: \`${versionRange.range}\`]`;
    if (versionRange.description) {
        tmpStr += ' ' + versionRange.description;
    }
    return tmpStr;
}

export function getLabelForCategory(categoryName: ReferenceCategory): string {
    switch (categoryName) {
        case 'constant':
            return 'constant';
        case 'variable':
            return 'variable';
        case 'array':
            return 'data-array';
        case 'macro':
            return 'macro';
        case 'function':
            return 'function';
        case 'keyword':
            return 'keyword';
        case 'snippet':
            return 'snippet';
        case 'enum':
            return 'member';
        case 'undefined':
            return 'unknown symbol';
        // default:
    }
}

function getCompletionItemKindForCategory(categoryName: ReferenceCategory): vscode.CompletionItemKind | undefined {
    switch (categoryName) {
        case 'constant':
            return vscode.CompletionItemKind.Constant;
        case 'variable':
            return vscode.CompletionItemKind.Variable;
        case 'array':
            return vscode.CompletionItemKind.Variable; // No specific kind for array.
        case 'macro':
            return vscode.CompletionItemKind.Module;
        case 'function':
            return vscode.CompletionItemKind.Function;
        case 'keyword':
            return vscode.CompletionItemKind.Keyword;
        case 'snippet':
            return vscode.CompletionItemKind.Snippet;
        case 'enum':
            return vscode.CompletionItemKind.EnumMember;
        case 'undefined':
            return undefined;
        // default:
    }
}

export function getSymbolKindForCategory(categoryName: ReferenceCategory): vscode.SymbolKind {
    switch (categoryName) {
        case 'constant':
            return vscode.SymbolKind.Constant;
        case 'variable':
            return vscode.SymbolKind.Variable;
        case 'array':
            return vscode.SymbolKind.Array;
        case 'macro':
            return vscode.SymbolKind.Module;
        case 'function':
            return vscode.SymbolKind.Function;
        case 'keyword':
            return vscode.SymbolKind.Null; // No specific kind for keyword.
        case 'snippet':
            return vscode.SymbolKind.Null; // No specific kind for snippet.
        case 'enum':
            return vscode.SymbolKind.EnumMember;
        // case 'undefined':
        default:
            return vscode.SymbolKind.Null;
    }
}

// function getIconIdentifierForCategory(categoryName: ReferenceCategory): string {
//     switch (categoryName) {
//         case 'constant':
//             return 'symbol-constant';
//         case 'variable':
//             return 'symbol-variable';
//         case 'array':
//             return 'symbol-array';
//         case 'macro':
//             return 'symbol-module';
//         case 'function':
//             return 'symbol-function';
//         case 'keyword':
//             return 'symbol-keyword';
//         case 'snippet':
//             return 'symbol-snippet';
//         case 'enum':
//             return 'symbol-enum-member';
//         case 'undefined':
//             return 'symbol-null';
//     }
// }

export class CompletionItem extends vscode.CompletionItem {
    readonly uriString: string;

    constructor(label: string | vscode.CompletionItemLabel, uriString: string, categoryName: ReferenceCategory) {
        super(label, getCompletionItemKindForCategory(categoryName));
        this.uriString = uriString;
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
        $schema: parserResult.$schema,
        kind: 'spec-command.dictionary',
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
                const refItem: ReferenceItem = { ...entry, category: categoryName as keyof typeof dictionary.categories };
                refBook.set(identifier, refItem);
            }
        }
    }
    return {
        identifier: dictionary.identifier,
        scope: dictionary.scope,
        $schema: dictionary.$schema,
        name: dictionary.name,
        description: dictionary.description,
        refBook,
    };
}
