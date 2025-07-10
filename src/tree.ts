/*
Type Definitions for spec language.

See LICENSE for the license of this file.

The extension author (@fujidana) has borrowed the naming convention of nodes 
from ESTree. However, owing to the grammatical difference between JavaScript 
and spec, the type definitions between them also have considerable differences.

The referred file is index.d.ts in @types/estraverse v5.1.7, obtained from:

https://www.npmjs.com/package/@types/estraverse
https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/estraverse/index.d.ts

The license of the referred file is as follows:
/*

/* 
    MIT License

    Copyright (c) Microsoft Corporation.

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE
 */

import type { DiagnosticSeverity } from 'vscode';
import type { LocationRange } from './parser';

/**
 * Node having a similar structure as `estree.BaseNodeWithoutComments`.
 * The type for `loc` property is not `estree.SourceLocation` but
 * `LocationRange` of Peggy.js parser.
 */
interface BaseNodeWithoutComments {
    type: string;
    loc?: LocationRange;
}

/** Node having the same structure as `estree.BaseNode`. */
interface BaseNode extends BaseNodeWithoutComments {
    leadingComments?: Comment[] | undefined;
    trailingComments?: Comment[] | undefined;
}

interface NodeMap {
    Program: Program;

    Statement: Statement;
    Expression: Expression;

    VariableDeclarator: VariableDeclarator;
    InternalDataArrayDeclarator: InternalDataArrayDeclarator;
    ExternalDataArrayDeclarator: ExternalDataArrayDeclarator;
    MemberAccessProperty: MemberAccessProperty;
    SliceElement: SliceElement;
    Property: Property;
    MacroParameter: MacroParameter;
}

export type Node = NodeMap[keyof NodeMap];

// // export type ChildStatement = InMenuStatement | InPictureStatement | InStructureStatement | InFunctionStatement;

/** Node having the same structure as `estree.Comment`. */
export interface Comment extends BaseNodeWithoutComments {
    type: 'Line' | 'Block';
    value: string;
}

// export interface BaseBlock extends BaseStatement {
//     innerComments?: Comment[];
// }

/** Custom node for representing problems in the code. */
export interface Problem extends BaseNode {
    message: string;
    severity: DiagnosticSeverity;
    loc: LocationRange;
}

/**
 * Node having similar structure to `estree.Program` but
 * `problems` property added and `sourceType` and `comments` removed.
 */
export interface Program extends BaseNode {
    type: 'Program';
    body: Statement[];
    problems: Problem[];
}

export type Statement =
    | BlockStatement
    | FunctionDeclaration
    | IfStatement
    | WhileStatement
    | ForStatement
    | ForInStatement
    | BreakStatement
    | ContinueStatement
    | ReturnStatement
    | VariableDeclaration
    | MacroStatement
    | ExpressionStatement

 // specific to spec, not included in ESTree
    | ExitStatement
    | QuitStatement
    | DataArrayDeclaration

    | EmptyStatement
    | UnclassifiedStatement;


export interface BaseStatement extends BaseNode { }

/** Node having the same structure as `estree.EmptyStatement`. */
export interface EmptyStatement extends BaseStatement {
    type: 'EmptyStatement';
}

/** Node having the same structure as `estree.BlockStatement`. */
export interface BlockStatement extends BaseStatement {
    type: 'BlockStatement';
    body: Statement[];
    innerComments?: Comment[] | undefined;
}

/** Custom node to catch unclassified statements. */
export interface UnclassifiedStatement extends BaseStatement {
    type: 'UnclassifiedStatement';
    value: string;
}

/** Node having the same structure as `estree.IfStatement`. */
export interface IfStatement extends BaseStatement {
    type: 'IfStatement';
    test: Expression;
    consequent: Statement;
    alternate?: Statement | null | undefined;
}

/** Node having the same structure as `estree.WhileStatement`. */
export interface WhileStatement extends BaseStatement {
    type: 'WhileStatement';
    test: Expression;
    body: Statement;
}

/** Node having nearly the same structure as `estree.ForStatement`. */
export interface ForStatement extends BaseStatement {
    type: 'ForStatement';
    init?: Expression | null | undefined; // Unlike JavaScript, VariableDeclaration is unavailable here.
    test?: Expression | null | undefined;
    update?: Expression | null | undefined;
    body: Statement;
}

/** Node having nearly the same structure as `estree.ForInStatement`. */
export interface ForInStatement extends BaseStatement {
    type: 'ForInStatement';
    left: Identifier | IndirectPattern; // Unlike JavaScript, VariableDeclaration is unavailable here.
    right: Expression;
    body: Statement;
}

/** Node similar to `estree.BreakStatement`, just lacking "label" property. */
export interface BreakStatement extends BaseStatement {
    type: 'BreakStatement';
}

/** Node similar to `estree.ContinueStatement`, just lacking "label" property. */
export interface ContinueStatement extends BaseStatement {
    type: 'ContinueStatement';
}

/** Node having the same structure as `estree.ReturnStatement`. */
export interface ReturnStatement extends BaseStatement {
    type: 'ReturnStatement';
    argument?: Expression | null | undefined;
}

/** Node specific to __spec__, no counterpart in ESTree. */
export interface ExitStatement extends BaseStatement {
    type: 'ExitStatement';
}

/** Node specific to __spec__, no counterpart in ESTree. */
export interface QuitStatement extends BaseStatement {
    type: 'QuitStatement';
}

// export type Declaration = FunctionDeclaration | VariableDeclaration | ClassDeclaration;

export interface BaseDeclaration extends BaseStatement {}

/**
 * Node similar to `estree.FunctionDeclaration`.
 *
 * This also covers a traditional macro, in that case `params === null`
 * (and in case of a macro function without parameters, `params === []`).
 * The structure is simpler than it since __spec__ does not support
 * anonymous functions or arrow functions.
*/
export interface FunctionDeclaration extends BaseStatement, BaseDeclaration {
    type: 'FunctionDeclaration';
    id: Identifier;
    params: Identifier[] | null; // Pattern[];
    body: BlockStatement;
    rdef: boolean;
}

/**
 * Node similar to `estree.VariableDeclaration`.
 *
 * This covers declarations of both variables (scalar and associative array)
 * and data arrays.
*/
export interface BaseVariableDeclaration extends BaseStatement, BaseDeclaration {
    type: 'VariableDeclaration';
    dataarray: boolean;
    declarations: BaseVariableDeclarator[];
    kind?: 'global' | 'local' | 'const' | 'shared' | 'extern' | undefined;
    datatype?: DataArrayUnit | null | undefined;
}

/** Node for variable declaration. */
export interface VariableDeclaration extends BaseVariableDeclaration {
    dataarray: false;
    kind: 'global' | 'local' | 'const';
    declarations: VariableDeclarator[];
    datatype: never;
}

/** Node for data array declaration. */
export interface DataArrayDeclaration extends BaseVariableDeclaration {
    dataarray: true;
    kind: 'global' | 'local' | 'shared' | 'extern' | undefined;
    declarations: (InternalDataArrayDeclarator | ExternalDataArrayDeclarator)[];
    datatype: DataArrayUnit;
}

/** Node similar to `estree.VariableDeclarator`.
 *
 * This covers declarators of variables (scalar and associative array),
 * internal data arrays, and external data arrays.
*/
export interface BaseVariableDeclarator extends BaseNode {
    type: 'VariableDeclarator';
    id: Identifier | IndirectPattern;
    assocarray?: boolean;
    init?: Expression | null | undefined;
    extern?: { spec?: string | undefined, pid?: number | undefined, raw: string, } | undefined;  // for external data array declaration.
    sizes? : Expression[] | undefined; // for internal data array declaration.
}

/** Node for a variable declarator. */
export interface VariableDeclarator extends BaseVariableDeclarator {
    assocarray: boolean;
    extern: never;
    sizes : never;
}

/** Node for internal data array declarator. */
export interface InternalDataArrayDeclarator extends BaseVariableDeclarator {
    assocarray: never;
    init: never;
    extern: never;
    sizes : Expression[];
}

/** Node for external data array declarator. */
export interface ExternalDataArrayDeclarator extends BaseVariableDeclarator {
    assocarray: never;
    init: never;
    extern: { spec?: string | undefined, pid?: number | undefined, raw: string, };
    size: never;
}


type DataArrayUnit =
    | 'string' | 'float' | 'double'
    | 'byte' | 'short' | 'long' | 'long64'
    | 'ubyte' | 'ushort' | 'ulong' | 'ulong64';

/** Node specific to __spec__, no counterpart in ESTree. */
export interface MacroStatement extends BaseStatement, BaseDeclaration {
    type: 'MacroStatement';
    callee: Identifier;
    arguments: Expression[];
    builtin?: boolean | undefined;
}

/** Node having the same structure as `estree.ExpressionStatement`. */
export interface ExpressionStatement extends BaseStatement {
    type: 'ExpressionStatement';
    expression: Expression;
}

// expression

export interface BaseExpression extends BaseNode { }

export interface ExpressionMap {
    SequenceExpression: SequenceExpression;
    UnaryExpression: UnaryExpression;
    BinaryExpression: BinaryExpression;
    AssignmentExpression: AssignmentExpression;
    UpdateExpression: UpdateExpression;
    LogicalExpression: LogicalExpression;
    ConditionalExpression: ConditionalExpression;
    CallExpression: CallExpression;
    MemberExpression: MemberExpression;
    Identifier: Identifier;
    Literal: Literal;
    ArrayPattern: ArrayPattern;
    IndirectPattern: IndirectPattern;
    // ArrayExpression: ArrayExpression;
    ObjectExpression: ObjectExpression;
    UnclassifiedExpression: UnclassifiedExpression;    
}

export type Expression = ExpressionMap[keyof ExpressionMap];


// export interface EmptyExpression extends BaseExpression {
//     type: 'EmptyExpression';
// }

// type LValue = BaseExpression; // TODO: limit to more specific types.

/**
 * Node having the same structure as `estree.SequenceExpression`.
 *
 * This can be used only at `init` and `update` of `ForStatement` and `ExpressionStatement`.
 * In this sense, it is not a strict member of `Expression`.
 */
export interface SequenceExpression extends BaseExpression {
    type: 'SequenceExpression';
    expressions: Expression[];
}

export interface UnaryExpression extends BaseExpression {
    type: 'UnaryExpression';
    operator: UnaryOperator;
    prefix: true;
    argument: Expression;
}

export interface BinaryExpression extends BaseExpression {
    type: 'BinaryExpression';
    operator: BinaryOperator;
    left: Expression;
    right: Expression;
}

// TODO: more precise type for `left`
export interface AssignmentExpression extends BaseExpression {
    type: 'AssignmentExpression';
    operator: AssignmentOperator;
    left: Identifier | IndirectPattern | MemberExpression;
    right: Expression;
}

/** Node close to `estree.UpdateExpression`. */
export interface UpdateExpression extends BaseExpression {
    type: 'UpdateExpression';
    operator: UpdateOperator;
    argument: Pattern; // Expression;
    prefix: boolean;
}

/** Node the same as `estree.LogicalExpression`. */
export interface LogicalExpression extends BaseExpression {
    type: 'LogicalExpression';
    operator: LogicalOperator;
    left: Expression;
    right: Expression;
}

/** Node the same as `estree.ConditionalExpression`. */
export interface ConditionalExpression extends BaseExpression {
    type: 'ConditionalExpression';
    test: Expression;
    alternate: Expression;
    consequent: Expression;
}

/** 
 * Node having a similar structure as `estree.BaseCallExpression`.
 * 
 * The type of a callee in __spec__ is much more limited than JavaScript.
 */
export interface CallExpression extends BaseExpression {
    type: 'CallExpression';
    callee: Pattern; // Expression | Super;
    arguments: Expression[];
}

export type UnaryOperator = '+' | '-' | '!' | '~';

export type BinaryOperator =
    | '+'
    | '-'
    | '*'
    | '/'
    | '%'
    | '<<'
    | '>>'
    | '<'
    | '<='
    | '>'
    | '>='
    | '=='
    | '!='
    | '&'
    | '^'
    | '|'
    | ':'
    | ' '; // used for string concatenation.

export type LogicalOperator = '||' | '&&';

export type AssignmentOperator =
    | '='
    | '+='
    | '-='
    | '*='
    | '/='
    | '%='
    | '<<='
    | '>>='
    | '&='
    | '^='
    | '|=';

export type UpdateOperator = '++' | '--';


export type Pattern = Identifier | IndirectPattern | MemberExpression;

/** Identifier, similar to `estree.Identifier` .*/
interface Identifier extends BaseExpression, BasePattern {
    type: 'Identifier';
    name: string;
    params: MacroParameter[] | undefined;
}

/** Node specific to __spec__, no counterpart in ESTree. */
export interface MacroParameter extends BaseNode {
    type: 'MacroParameter';
    name: string;
}

/** 
 * Literal value, either string or number.
 * This is similar to `estree.SimpleLiteral` but does not
 * contain `boolean` in `value` property.
 */
export interface Literal extends BaseExpression {
    type: 'Literal';
    value: string | number | null;
    raw?: string | undefined;
}

export interface BasePattern extends BaseNode {}

// export interface AssignmentPattern extends BasePattern {
//     type: 'AssignmentPattern';
//     left: Identifier;
//     right: Expression;
// }

/** Node similar to `estree.ArrayPattern`. */
export interface ArrayPattern extends BaseExpression, BasePattern {
    type: 'ArrayPattern';
    elements: (Expression | null)[] // Array<Pattern | null>;
}

/**
 * Node specific to __spec__, no counterpart in ESTree.
 * 
 * Reference to a variable using indirect operator "@" and
 * a following expression.
 */
interface IndirectPattern extends BaseExpression, BasePattern {
    type: 'IndirectPattern';
    expression: Expression;
}

/**
 * Node similar to `estree.MemberExpression` but having "properties" 
 * instead of "property".
 * e.g., `assoc_array[]`, `data_array[1, 3:5][4]`
 */
export interface MemberExpression extends BaseExpression, BasePattern {
    type: 'MemberExpression';
    object: Identifier | IndirectPattern; // Expression;
    properties: MemberAccessProperty[]; // property: Expression;
}

/**  Node specific to __spec__, no counterpart in ESTree. */
export interface MemberAccessProperty extends BaseNode {
    type: 'MemberAccessProperty';
    values: (Expression | SliceElement)[];
}

/**  Node specific to __spec__, no counterpart in ESTree. */
export interface SliceElement extends BaseNode {
    type: 'SliceElement';
    start: Expression;
    end: Expression;
}

// export interface ArrayExpression extends BaseExpression {
//     type: 'ArrayExpression';
//     elements: Expression[];
//     kind: 'brace' | 'bracket' | 'parenthesis'; // `{}` | `[]` | `()`
// }

/** Node similar to `estree.ObjectExpression`. */
export interface ObjectExpression extends BaseExpression {
    type: 'ObjectExpression';
    properties: (Property | Expression)[];
}

/** Node similar to `estree.Property`, having `keys` instead of `key`. */
export interface Property extends BaseNode {
    type: 'Property';
    keys: Expression[];
    value: Expression;
}

export interface UnclassifiedExpression extends BaseExpression {
    type: 'UnclassifiedExpression';
    raw?: string | undefined;
}
