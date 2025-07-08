import * as vscode from 'vscode';
// import * as estraverse from 'estraverse';
import * as lang from './language';
import type { LocationRange } from './parser';
import type * as tree from './tree';

const estraverse = require('estraverse');

/**
 * Visitor keys for spec language.
 */
const VISITOR_KEYS = {
    Program: ['body'],
    EmptyStatement: [],
    BlockStatement: ['body'],
    IfStatement: ['test', 'consequent', 'alternate'],
    WhileStatement: ['test', 'body'],
    ForStatement: ['init', 'test', 'update', 'body'],
    ForInStatement: ['left', 'right', 'body'],
    BreakStatement: [], // ['label'],
    ContinueStatement: [], // ['label'],
    ReturnStatement: ['argument'],
    FunctionDeclaration: ['id', 'params', 'body'],
    VariableDeclaration: ['declarations'],
    VariableDeclarator: ['id', 'init'],
    ExpressionStatement: ['expression'],
    SequenceExpression: ['expressions'],
    UnaryExpression: ['argument'],
    BinaryExpression: ['left', 'right'],
    AssignmentExpression: ['left', 'right'],
    UpdateExpression: ['argument'],
    LogicalExpression: ['left', 'right'],
    ConditionalExpression: ['test', 'consequent', 'alternate'],
    CallExpression: ['callee', 'arguments'],
    MemberExpression: ['object', 'properties'], // ['object', 'property'],
    ObjectExpression: ['properties'],
    Property: ['key', 'value'],
    Identifier: ['params'], //[],
    Literal: [],
    ArrayPattern: ['elements'],

    // Node types specific to spec.
    MacroStatement: ['callee', 'arguments'],
    ExitStatement: [],
    QuitStatement: [],
    UnclassifiedStatement: [],
    IndirectPattern: ['expression'],
    MemberAccessProperty: ['values'],
    SliceElement: ['start', 'end'],
    MacroParameter: [],
};

export function traverseWholly(program: tree.Program, diagnosticRules: lang.DiagnosticRules | undefined): [lang.ReferenceBook, vscode.DocumentSymbol[], vscode.Diagnostic[]] {
    // Create variables to store data.
    const refBook = {
        constant: new Map<string, lang.ReferenceItem>(),
        variable: new Map<string, lang.ReferenceItem>(),
        array: new Map<string, lang.ReferenceItem>(),
        macro: new Map<string, lang.ReferenceItem>(),
        function: new Map<string, lang.ReferenceItem>(),
    };
    const symbols: vscode.DocumentSymbol[] = [];
    const diagnostics: vscode.Diagnostic[] = [];
    const blockStack: tree.BlockStatement[] = [];

    // Traverse the syntax tree.
    estraverse.traverse(program, {
        enter: (node: tree.Node, parent: tree.Node | null) => {
            // console.log('enter', node.type, parent?.type);

            if (parent === null && node.type === 'Program') {
                // if it is a top-level, dig in.
                return;
            } else if (node.type.endsWith('Statement') || node.type.endsWith('Declaration')) {
                if (!node.loc) {
                    console.log('Statement should have location. This may be a bug in the parser.');
                    return;
                }
                const nodeRange = lang.convertRange(node.loc);

                // Treat a line comment starting with `MARK|TODO|FIXME` as a symbol.
                if (node.leadingComments) {
                    for (const leadingComment of node.leadingComments) {
                        let matched: RegExpMatchArray | null;
                        if (leadingComment.type === 'Line' && leadingComment.loc && (matched = leadingComment.value.match(/^(\s*(MARK|TODO|FIXME):\s+)((?:(?!--).)+)(?:--\s*(.+))?$/)) !== null) {
                            const range1 = lang.convertRange(leadingComment.loc);
                            const range2 = range1.with(range1.start.translate(undefined, matched[1].length + 1));
                            const symbol = new vscode.DocumentSymbol(matched[3], matched[4] !== undefined ? matched[4] : '', vscode.SymbolKind.Key, range1, range2);
                            if (symbols.length !== 0 && symbols[symbols.length - 1].range.contains(range1)) {
                                symbols[symbols.length - 1].children.push(symbol);
                            } else {
                                symbols.push(symbol);
                            }
                        }
                    }
                }

                if (node.type === 'FunctionDeclaration') {
                    // Register a document symbol.
                    if (node.id && node.id.loc) {
                        const idName = node.id.name;
                        const idRange = lang.convertRange(node.id.loc);

                        let symbolKind: vscode.SymbolKind;
                        if (node.params) {
                            symbolKind = vscode.SymbolKind.Function;
                            // const params = currentNode.params.map(param => (param.type === 'Identifier') ? param.name : '') ;
                            // symbol = new vscode.DocumentSymbol(idName, '(' + params.join(' ,') + ')', vscode.SymbolKind.Function, stmtRange, idRange);
                        } else {
                            symbolKind = vscode.SymbolKind.Module;
                        }
                        const symbol = new vscode.DocumentSymbol(idName, '', symbolKind, nodeRange, idRange);

                        if (symbols.length !== 0 && symbols[symbols.length - 1].range.contains(nodeRange)) {
                            symbols[symbols.length - 1].children.push(symbol);
                        } else {
                            symbols.push(symbol);
                        }
                    }

                    // Register a top-level item as a reference item.
                    if (parent?.type === 'Program') {
                        if (node.params) {
                            // Register the id as a function if parameter is not null.
                            const signature = `${node.id.name}(${node.params.map(param => (param.type === 'Identifier') ? param.name : '').join(', ')})`;
                            refBook.function.set(node.id.name, makeReferenceItem(node, signature));
                        } else {
                            // Register the id as a traditional macro if parameter is null.
                            refBook.macro.set(node.id.name, makeReferenceItem(node, node.id.name));
                        }
                    }

                } else if (node.type === 'VariableDeclaration') {
                    // Register a document symbol.
                    for (const declarator of node.declarations) {
                        if (declarator.id.type === 'Identifier' && declarator.id.loc) {
                            const idName = declarator.id.name;
                            const idRange = lang.convertRange(declarator.id.loc as LocationRange);
                            const idDetail = '';
                            // const idDetail = (declarator.init && declarator.init.type === 'Literal' && declarator.init.raw) ? ' = ' + declarator.init.raw : '';
                            let symbolKind: vscode.SymbolKind;
                            if (node.dataarray) {
                                symbolKind = vscode.SymbolKind.Array;
                            } else if (node.kind === 'const') {
                                symbolKind = vscode.SymbolKind.Constant;
                            } else if (node.kind === 'local' || node.kind === 'global') {
                                symbolKind = vscode.SymbolKind.Variable;
                            } else {
                                symbolKind = vscode.SymbolKind.Null;
                            }
                            const symbol = new vscode.DocumentSymbol(idName, idDetail, symbolKind, idRange, idRange);
                            if (symbols.length !== 0 && symbols[symbols.length - 1].range.contains(nodeRange)) {
                                symbols[symbols.length - 1].children.push(symbol);
                            } else {
                                symbols.push(symbol);
                            }
                        }
                    }

                    // Register a top-level item as a reference item.
                    if (parent?.type === 'Program') {
                        for (const declarator of node.declarations) {
                            if (declarator.id.type === 'Identifier') {
                                const signature =
                                    declarator.init?.type === 'Literal' ?
                                        `${declarator.id.name} = ${declarator.init.raw}` :
                                        declarator.id.name;
                                const refItem = makeReferenceItem(node, signature);
                                if (node.dataarray) {
                                    refBook.array.set(declarator.id.name, refItem);
                                } else if (node.kind === 'const') {
                                    refBook.constant.set(declarator.id.name, refItem);
                                } else if (node.kind === 'local' || node.kind === 'global') {
                                    refBook.variable.set(declarator.id.name, refItem);
                                } else {
                                    console.log(`Failed to categorize variable declaration for ${declarator.id.name}`);
                                }
                            }
                        }
                    }

                    // Diagnose problems.
                    if (diagnosticRules && diagnosticRules['no-local-outside-block']) {
                        if (node.kind === 'local' && blockStack.length === 0) {
                            diagnostics.push(new vscode.Diagnostic(nodeRange, 'Local variable declaration outside a block.', vscode.DiagnosticSeverity.Warning));
                        }
                    }
                } else if (node.type === 'BlockStatement') {
                    // If it is a block statement, push it to the stack.
                    blockStack.push(node);
                }
            } else {
                // If not any type of statements, skip.
                return estraverse.VisitorOption.Skip;
            }
        },
        leave: (node: tree.Node, parent: tree.Node | null) => {
            // console.log('leave', node.type, parent?.type);
            if (node.type === 'BlockStatement') {
                const block = blockStack.pop();
                if (block !== node) {
                    console.log('Block stack mismatch. This may be a bug in the parser or the traverser.');
                }
            }
        },
        keys: VISITOR_KEYS,
    });

    return [refBook, symbols, diagnostics];
}

export function traversePartially(program: tree.Program, position: vscode.Position): lang.ReferenceBook {
    // Create variables to store data.
    const refBook = {
        constant: new Map<string, lang.ReferenceItem>(),
        variable: new Map<string, lang.ReferenceItem>(),
        array: new Map<string, lang.ReferenceItem>(),
        macro: new Map<string, lang.ReferenceItem>(),
        function: new Map<string, lang.ReferenceItem>(),
    };

    // Traverse the syntax tree.
    estraverse.traverse(program, {
        enter: (node: tree.Node, parent: tree.Node | null) => {
            // console.log('enter', node.type, parent?.type);

            if (parent === null && node.type === 'Program') {
                // if it is a top-level, dig in.
                return;
            } else if (!node.type.endsWith('Statement') && !node.type.endsWith('Declaration')) {
                // if not any type of statements, skip.
                return estraverse.VisitorOption.Skip;
            } else if (!node.loc) {
                console.log('Statement should have location. This may be a bug in the parser.');
                return;
            }

            const nodeRange = lang.convertRange(node.loc);

            // in case of active document
            // if (nodeRange.contains(position)) {
            //     nestedNodes.push(node.type);
            // }

            if (node.type === 'BlockStatement' && nodeRange.end.isBefore(position)) {
                // Skip the code block that ends before the cursor.
                return estraverse.VisitorOption.Skip;

            } else if (node.type === 'FunctionDeclaration' && node.params && nodeRange.contains(position)) {
                // Register arguments of function as variables if the cursor is in the function block.
                for (const param of node.params) {
                    if (param.type === 'Identifier') {
                        const refItem = { signature: param.name, location: node.loc as LocationRange };
                        refBook.variable.set(param.name, refItem);
                    }
                }
            } else if (nodeRange.start.isAfter(position)) {
                return estraverse.VisitorOption.Break;
            }

            if (parent?.type !== 'Program') {
                if (node.type === 'FunctionDeclaration' && node.id) {
                    if (node.params) {
                        // register the id as a function if parameter is not null.
                        const signature = `${node.id.name}(${node.params.map(param => (param.type === 'Identifier') ? param.name : '').join(', ')})`;
                        refBook.function.set(node.id.name, makeReferenceItem(node, signature));
                    } else {
                        // register the id as a traditional macro if parameter is null.
                        refBook.macro.set(node.id.name, makeReferenceItem(node, node.id.name));
                    }
                } else if (node.type === 'VariableDeclaration') {
                    for (const declarator of node.declarations) {
                        if (declarator.id.type === 'Identifier') {
                            const signature =
                                declarator.init?.type === 'Literal' ?
                                    `${declarator.id.name} = ${declarator.init.raw}` :
                                    declarator.id.name;
                            const refItem = makeReferenceItem(node, signature);
                            if (node.dataarray) {
                                refBook.array.set(declarator.id.name, refItem);
                            } else if (node.kind === 'const') {
                                refBook.constant.set(declarator.id.name, refItem);
                            } else if (node.kind === 'local' || node.kind === 'global') {
                                refBook.variable.set(declarator.id.name, refItem);
                            } else {
                                console.log(`Failed to categorize variable declaration for ${declarator.id.name}`);
                            }
                        }
                    }
                }
            }
        },
        // leave: (node, parent) => {
        //     console.log('leave', node.type, parent?.type);
        // },
        keys: VISITOR_KEYS,
    });

    return refBook;
}

function makeReferenceItem(node: tree.Node, signature: string): lang.ReferenceItem {
    // Create a reference item from the node and signature string.
    const refItem: lang.ReferenceItem = { signature, location: node.loc as LocationRange };
    if (node.leadingComments && node.leadingComments.length > 0) {
        refItem.description = node.leadingComments[node.leadingComments.length - 1].value;
    }
    return refItem;
}
