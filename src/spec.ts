import * as vscode from 'vscode';
import { IFileRange, IFilePosition } from './grammar';

export function convertPosition(position: IFilePosition): vscode.Position {
    return new vscode.Position(position.line - 1, position.column - 1);
}
export function convertRange(range: IFileRange): vscode.Range {
    return new vscode.Range(convertPosition(range.start), convertPosition(range.end));
}
export const CMD_SELECTOR = [{ scheme: 'file', language: 'spec-cmd' }, { scheme: 'untitled', language: 'spec-cmd' }];
export const BUILTIN_URI = 'spec://system/built-in.md';
export const MOTOR_URI = 'spec://system/mnemonic-motor.md';
export const COUNTER_URI = 'spec://system/mnemonic-counter.md';
export const SNIPPET_URI = 'spec://system/code-snippet.md';
export const ACTIVE_FILE_URI = 'spec://user/active-document.md';

export const enum ReferenceItemKind {
    Undefined = 0,
    Constant,
    Variable,
    Macro,
    Function,
    Keyword,
    Snippet,
    Enum,
}

export function getReferenceItemKindFromCompletionItemKind(completionItemKind?: vscode.CompletionItemKind): ReferenceItemKind {
    switch (completionItemKind) {
        case vscode.CompletionItemKind.Constant:
            return ReferenceItemKind.Constant;
        case vscode.CompletionItemKind.Variable:
            return ReferenceItemKind.Variable;
        case vscode.CompletionItemKind.Module:
            return ReferenceItemKind.Macro;
        case vscode.CompletionItemKind.Function:
            return ReferenceItemKind.Function;
        case vscode.CompletionItemKind.Keyword:
            return ReferenceItemKind.Keyword;
        case vscode.CompletionItemKind.Snippet:
            return ReferenceItemKind.Snippet;
        case vscode.CompletionItemKind.EnumMember:
            return ReferenceItemKind.Enum;
        default:
            return ReferenceItemKind.Undefined;
    }
}
export function getCompletionItemKindFromReferenceItemKind(refItemKind: ReferenceItemKind): vscode.CompletionItemKind | undefined {
    switch (refItemKind) {
        case ReferenceItemKind.Constant:
            return vscode.CompletionItemKind.Constant;
        case ReferenceItemKind.Variable:
            return vscode.CompletionItemKind.Variable;
        case ReferenceItemKind.Macro:
            return vscode.CompletionItemKind.Module;
        case ReferenceItemKind.Function:
            return vscode.CompletionItemKind.Function;
        case ReferenceItemKind.Keyword:
            return vscode.CompletionItemKind.Keyword;
        case ReferenceItemKind.Snippet:
            return vscode.CompletionItemKind.Snippet;
        case ReferenceItemKind.Enum:
            return vscode.CompletionItemKind.EnumMember;
        case ReferenceItemKind.Undefined:
            return undefined;
        default:
            return undefined;
    }
}

export function getSymbolKindFromReferenceItemKind(refItemKind: ReferenceItemKind): vscode.SymbolKind {
    switch (refItemKind) {
        case ReferenceItemKind.Constant:
            return vscode.SymbolKind.Constant;
        case ReferenceItemKind.Variable:
            return vscode.SymbolKind.Variable;
        case ReferenceItemKind.Macro:
            return vscode.SymbolKind.Module;
        case ReferenceItemKind.Function:
            return vscode.SymbolKind.Function;
        // case ReferenceItemKind.Keyword:
        // case ReferenceItemKind.Snippet:
        case ReferenceItemKind.Enum:
            return vscode.SymbolKind.EnumMember;
        case ReferenceItemKind.Undefined:
            return vscode.SymbolKind.Null;
        default:
            return vscode.SymbolKind.Null;
    }
}

export function getStringFromReferenceItemKind(refItemKind: ReferenceItemKind): string {
    switch (refItemKind) {
        case ReferenceItemKind.Constant:
            return "constant";
        case ReferenceItemKind.Variable:
            return "variable";
        case ReferenceItemKind.Macro:
            return "macro";
        case ReferenceItemKind.Function:
            return "function";
        case ReferenceItemKind.Keyword:
            return "keyword";
        case ReferenceItemKind.Snippet:
            return "snippet";
        case ReferenceItemKind.Enum:
            return "member";
        default:
            return "symbol";
    }
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
