/* eslint-disable @typescript-eslint/naming-convention */

import * as vscode from 'vscode';
import { IFileRange, IFilePosition } from './grammar';

export function convertPosition(position: IFilePosition): vscode.Position {
    return new vscode.Position(position.line - 1, position.column - 1);
}

export function convertRange(range: IFileRange): vscode.Range {
    return new vscode.Range(convertPosition(range.start), convertPosition(range.end));
}

export const SELECTOR = { language: 'spec-command' };
// export const SELECTOR = [{ scheme: 'file', language: 'spec-command' }, { scheme: 'untitled', language: 'spec-command' }];
export const BUILTIN_URI = 'spec-command://system/built-in.md';
export const MOTOR_URI = 'spec-command://system/mnemonic-motor.md';
export const COUNTER_URI = 'spec-command://system/mnemonic-counter.md';
export const SNIPPET_URI = 'spec-command://system/code-snippet.md';
export const ACTIVE_FILE_URI = 'spec-command://user/active-document.md';

export const enum ReferenceItemKind {
    Undefined = 0,
    Constant,
    Variable,
    Array,
    Macro,
    Function,
    Keyword,
    Snippet,
    Enum,
}

type ReferenceItemKindMetadata = { label: string, iconIdentifier: string, completionItemKind: vscode.CompletionItemKind | undefined, symbolKind: vscode.SymbolKind };

export function getReferenceItemKindMetadata(refItemKind: ReferenceItemKind) : ReferenceItemKindMetadata {
    switch (refItemKind) {
        case ReferenceItemKind.Constant:
            return {
                label: "constant",
                iconIdentifier: 'symbol-constant',
                completionItemKind: vscode.CompletionItemKind.Constant,
                symbolKind: vscode.SymbolKind.Constant
            };
        case ReferenceItemKind.Variable:
            return {
                label: "variable",
                iconIdentifier: 'symbol-variable',
                completionItemKind: vscode.CompletionItemKind.Variable,
                symbolKind: vscode.SymbolKind.Variable
            };
            case ReferenceItemKind.Array:
                return {
                    label: "data-array",
                    iconIdentifier: 'symbol-array',
                    completionItemKind: vscode.CompletionItemKind.Variable,
                    symbolKind: vscode.SymbolKind.Array
                };
            case ReferenceItemKind.Macro:
            return {
                label: "macro",
                iconIdentifier: 'symbol-module',
                completionItemKind: vscode.CompletionItemKind.Module,
                symbolKind: vscode.SymbolKind.Module
            };
        case ReferenceItemKind.Function:
            return {
                label: "function",
                iconIdentifier: 'symbol-function',
                completionItemKind: vscode.CompletionItemKind.Function,
                symbolKind: vscode.SymbolKind.Function
            };
        case ReferenceItemKind.Keyword:
            return {
                label: "keyword",
                iconIdentifier: 'symbol-keyword',
                completionItemKind: vscode.CompletionItemKind.Keyword,
                symbolKind: vscode.SymbolKind.Null // no corresponding value
            };
        case ReferenceItemKind.Snippet:
            return {
                label: "snippet",
                iconIdentifier: 'symbol-snippet',
                completionItemKind: vscode.CompletionItemKind.Snippet,
                symbolKind: vscode.SymbolKind.Null // no corresponding value
            };
        case ReferenceItemKind.Enum:
            return {
                label: "member",
                iconIdentifier: 'symbol-enum-member',
                completionItemKind: vscode.CompletionItemKind.EnumMember,
                symbolKind: vscode.SymbolKind.EnumMember
            };
        case ReferenceItemKind.Undefined:
            return {
                label: "unknown symbol",
                iconIdentifier: 'symbol-null',
                completionItemKind: undefined,
                symbolKind: vscode.SymbolKind.Null
            };
    }
}

export class CompletionItem extends vscode.CompletionItem {
    readonly uriString: string;
    readonly refItemKind: ReferenceItemKind;

    constructor(label: string | vscode.CompletionItemLabel, uriString: string, refItemKind: ReferenceItemKind) {
        super(label, getReferenceItemKindMetadata(refItemKind).completionItemKind);
        this.uriString = uriString;
        this.refItemKind = refItemKind;
    };
}

// 'overloads' parameter is for built-in macros and functions.
export type ReferenceItem = {
    signature: string;
    description?: string;
    comments?: string;
    snippet?: string;
    location?: IFileRange;
    overloads?: {
        signature: string;
        description?: string;
    }[];
};

export type ReferenceMap = Map<string, ReferenceItem>;

export type ReferenceStorage = Map<ReferenceItemKind, ReferenceMap>;
