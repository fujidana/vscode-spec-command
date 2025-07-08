import * as vscode from 'vscode';
import type { LocationRange, Location } from './parser';

export const SELECTOR = { language: 'spec-command' };
// export const SELECTOR = [{ scheme: 'file', language: 'spec-command' }, { scheme: 'untitled', language: 'spec-command' }];
export const BUILTIN_URI = 'spec-command://system/built-in.md';
export const MOTOR_URI = 'spec-command://system/mnemonic-motor.md';
export const COUNTER_URI = 'spec-command://system/mnemonic-counter.md';
export const SNIPPET_URI = 'spec-command://system/code-snippet.md';
export const ACTIVE_FILE_URI = 'spec-command://user/active-document.md';
export const AST_URI = 'spec-command://user/ast.json';

export function convertPosition(position: Location): vscode.Position {
    return new vscode.Position(position.line - 1, position.column - 1);
}

export function convertRange(range: LocationRange): vscode.Range {
    return new vscode.Range(convertPosition(range.start), convertPosition(range.end));
}

// 'overloads' parameter is used only by built-in macros and functions.
export type ReferenceItem = {
    signature: string;
    description?: string;
    available?: VersionRange;
    deprecated?: VersionRange;
    snippet?: string;
    location?: LocationRange;
    overloads?: {
        signature: string;
        description?: string;
    }[];
};

export type VersionRange = {
    range: string;
    description?: string;
};

export type ReferenceSheet = Map<string, ReferenceItem>;

const ReferenceCategoryNames = ['undefined', 'constant', 'variable', 'array', 'macro', 'function', 'keyword', 'snippet', 'enum'] as const;

export type ReferenceCategory = typeof ReferenceCategoryNames[number];
export type ReferenceBook = { [K in ReferenceCategory]?: ReferenceSheet; };
// export type ReferenceBook = Map<ReferenceCategory, ReferenceSheet>;

type ReferenceCategoryMetadata = { label: string, iconIdentifier: string, completionItemKind: vscode.CompletionItemKind | undefined, symbolKind: vscode.SymbolKind };

export function getVersionRangeDescription(versionRange: VersionRange, label: string) {
    let tmpStr = versionRange.range === '>=0.0.0' ? `[${label} at some time]` : `[${label}: \`${versionRange.range}\`]`;
    if (versionRange.description) {
        tmpStr += ' ' + versionRange.description;
    }
    return tmpStr;
}

export const referenceCategoryMetadata: { [K in ReferenceCategory]: ReferenceCategoryMetadata } = {
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
};

export type DiagnosticRules = typeof defaultDiagnosticRules;
