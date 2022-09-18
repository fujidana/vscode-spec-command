/** 
 * This is a source file written in Peggy.js (https://peggyjs.org) syntax with
 * TS PEG.js plugin (https://github.com/metadevpro/ts-pegjs).
 * A typescript file converted from this file parses spec command files and
 * outputs a JavaScript object that resembles the Parser AST (abstract syntax tree, 
 * https://developer.mozilla.org/en-US/docs/Mozilla/Projects/SpiderMonkey/Parser_API).
 */

{{
interface Diagnostic {
  location: IFileRange,
  message: string,
  severity: DiagnosticSeverity,
}

const INVALID_STATEMENT = { type: 'InvalidStatement' };
const NULL_EXPRESSION = { type: 'NullExpression' };
const NULL_LITERAL = { type: 'Literal', value: null, raw: 'null'};

const _reservedKeywordRegExp = new RegExp(
  '^('
  + 'def|rdef|constant|local|global|un(?:def|global)|delete|shared|extern|array'
  + '|float|double|string|byte|short|long(?:64)?|u(?:byte|short|long(?:64)?)'
  + '|if|else|while|for|in|break|continue|exit|return|quit'
  + '|memstat|savstate|reconfig|getcounts|move_(?:all|cnt)|sync'
  + '|ls(?:cmd|def)|prdef|syms'
  + ')$'
);

const _ttyCommandRegExp = /^(c(?:d|e)|do|ho|le|m(?:b|d|e|h|r)|nd|s(?:e|o)|u(?:e|p|s))$/;
const _patternRegExp = /^[a-zA-Z0-9_*?]+$/;
}}

{
const _diagnostics: Diagnostic[] = [];
const _quoteStack: string[] = [];

/**
 * create diagnostic object and store it.
 */
function pushDiagnostic(location: IFileRange, message: string, severity: DiagnosticSeverity) {
  _diagnostics.push({ location, message, severity });
}

/**
 * Return a new range object whose 'start' is identical to 'range' and the length is equal to 'length'.
 */
function shortenRange(range: IFileRange, length: number): IFileRange {
  const newRange = { ...range };
  newRange.end = { line: range.start.line, offset: range.start.offset + length, column: range.start.column + length };
  return newRange;
}

/**
 *
 */
function diagnoseEmptyArray<T>(elements: T[] | null, loc: IFileRange, label: string, severity: DiagnosticSeverity) {
  if (!elements || elements.length === 0) {
    pushDiagnostic(loc, `Expected at least one ${label}.`, severity);
    return [];
  }
  return elements;
}

/**
 * Make array from an array of [identifier | null, separator, location, option?].
 */
function diagnoseListItems<T>(elements: [T, string, IFileRange][], label: string, sepOption: number) {
  const items: T[] = [];
  for (let index = 0; index < elements.length; index++) {
    const [item, sep, locEach] = elements[index];
    if (!item) {
      pushDiagnostic(locEach, `Expected ${label}.`, DiagnosticSeverity.Error);
      continue;
    }
    items.push(item);

    if (index === elements.length - 1) {
      if (sep === ',') {
        pushDiagnostic(locEach, 'Trailing comma not allowed.', DiagnosticSeverity.Error);
      }
    } else if (sepOption === 1 && sep !== ',') {
      pushDiagnostic(locEach, 'Seprator must be a comma.', DiagnosticSeverity.Error);
    } else if (sepOption === 2 && sep !== ' ') {
      pushDiagnostic(locEach, 'Seprator must be a whitespace.', DiagnosticSeverity.Error);
    }
  }
  return items;
}

/**
 * Make Variable Declarators from an array of [identifier | null, separator, location, option?].
 */
function makeDeclarators(elements: [any, string, IFileRange, any][] | null, locAll: IFileRange, label: string, allowsAssign: boolean) {
  if (!elements || elements.length === 0) {
    pushDiagnostic(locAll, `Expected at least one ${label}.`, DiagnosticSeverity.Error);
    return [];
  } else if (elements[elements.length - 1][1] === ',') {
    pushDiagnostic(elements[elements.length - 1][2], `Trailing comma not allowed.`, DiagnosticSeverity.Error);
  } else if (elements.some((item: [any, string, IFileRange, any]) => item[3].init !== null)) {
    if (!allowsAssign) {
      pushDiagnostic(locAll, `Assignment not allowed.`, DiagnosticSeverity.Error);
    } else if (elements.length > 1) {
      pushDiagnostic(locAll, `Only one variable per statement can be declared and initialized.`, DiagnosticSeverity.Error);
    }
  }

  const declarators: any[] = [];
  for (const [identifier, separator, locEach, option] of elements) {
    if (!identifier) {
      pushDiagnostic(locEach, `Expected ${label}.`, DiagnosticSeverity.Error);
      continue;
    }
    let obj = { type: 'VariableDeclarator', id: identifier, loc: locEach };
    if (option) {
      Object.assign(obj, option);
    }
    declarators.push(obj);
  }
  
  return declarators;
}

/**
 * Make a sequence expression from array.
 * If an array is empty or null, null is returned.
 * If an array has only one Expression, it returns the Expression itself (not array).
 * If an array has two or more expressions, it returns a Sequence Expression containing the elements.
 */
function makeSequenceExpression(elements: any[] | null) {
  if (elements === null || elements.length === 0) {
    return null;
  } else if (elements.length === 1) {
    return elements[0];
  } else {
    return { type: 'SequenceExpression', expressions: elements };
  }
}

/**
 * Make nested expression for binary operation.
 * head must be an expression. tails must be [string, any]
 */
function getBinaryExpression(head: any, tails: [string, any], option = 0) {
  return tails.reduce((accumulator: any, currentValue: any) => {
    const op = currentValue[0];
    const term = currentValue[1];
    return {
      type: option === 1 ? 'LogicalExpression' : 'BinaryExpression',
      operator: op,
      left: accumulator,
      right: term,
    };
  }, head);
}

/**
 *
 */
function testIfQuoteIsAvailable(quote: string): boolean {
  if (quote === '"' && (_quoteStack.includes('"') || _quoteStack.includes('\\"'))) {
    return false;
  } else if (quote === "'" && (_quoteStack.includes("'") || _quoteStack.includes("\\'"))) {
    return false;
  } else if (quote === '\\"' && _quoteStack.includes('\\"')) {
    return false;
  } else if (quote === "\\'" && _quoteStack.includes("\\'")) {
    return false;
  } else {
    return true;
  }
}

/**
 *
 */
function testIfEscapedCharIsAvailable(escapedChar: string): boolean {
  return _quoteStack.every(quote => quote.length !== 2 || quote.substring(1, 2) !== escapedChar);
}

/**
 *
 */
function testIfUnescapedCharIsAvailable(unescapedChar: string): boolean {
  return _quoteStack.every(quote => quote.length !== 1 || quote !== unescapedChar);
}
}

// # MAIN

Start =
  body:Stmt* {
    return { type: 'Program', body: body, exDiagnostics: _diagnostics, };
  }


// # AUXILIARIES

Eol 'end of line' = '\n' / '\r\n'
Eof 'end of file' = !.
LineComment 'line comment' =
  @('#' p:$(!Eol .)* {
    return { type: 'Line', value: p, loc: location(), };
  }) (Eol / Eof)

QuotationMark 'quotation mark' = $('\\'? ('"' / "'"))

Eos0 = Eof { } / & QuotationMark { } / & '}' { }
Eos1 = Eol { } / LineComment / ';' Eol? { } 
Eos 'end of statement' = Eos1  / Eos0

BlockComment 'block comment' =
  '"""' p:$(!'"""' .)* closer:'"""'? {
    if (!closer) {
      pushDiagnostic(shortenRange(location(), 3), 'Unterminated docstring.', DiagnosticSeverity.Error);
    }
    return { type: 'Block', value: p, loc: location(), };
  }

__ 'whitespace' =
  $(' ' / '\t' / '\\' Eol / BlockComment {
    pushDiagnostic(location(), 'Inline docstring not recommended.', DiagnosticSeverity.Information); return text();
  })

_1 'whitespaces'          = __+
_0 'optional whitespaces' = __*

Word = [a-zA-Z0-9_]
ListSep =
  _0 ',' _0 { return ','; } / _1 { return ' '; }
CommaSep =
  _0 ',' _0 { return ','; }

// # STATEMENTS
 
 /**
  * BNF> statement
  * Statement with or without leading comments.
  */
Stmt 'statement' =
  comments:LeadingComment* statement:(EmptyStmt / NonemptyStmt) {
    if (comments && comments.length > 0) {
      statement.leadingComments = comments;
    }
    return statement;
  }
  /
  comments:LeadingComment+ Eos0 {
    return { type: 'EmptyStatement', loc: location(), leadingComments:comments, };
  }

/**
 * Empty line containing only whitespaces and a line or block comment,
 * which is treated as the leading comments of the succeeding statement.
 */
LeadingComment 'empty statement with comment' =
  [ \t]* @(LineComment / @BlockComment [ \t]* (Eol / Eof))

/**
 * Empty statement. It may contains line or block comments.
 */
EmptyStmt 'empty statement' =
  (_0 Eos1 / _1 Eos0) {
    return { type: 'EmptyStatement', loc: location(), };
  }

/**
 * Nonempty statement.
 */
NonemptyStmt 'nonempty statement' =
  _0 p:(
    BlockStmt
    / IfStmt / WhileStmt / ForStmt / BreakStmt / ContinueStmt / ReturnStmt / ExitStmt
    / MacroDef / UndefStmt / RdefStmt / DataArrayDef / VariableDef / ConstantDef
    / DeleteStmt / PatternStmt / BuiltinMacroStmt / ExprStmt
  ) {
    p.loc = location();
    return p;
  }

/**
 * <BNF> compound-statement:
 *         { statement-list }
 */
BlockStmt 'block statement' =
  '{' _0 Eos? stmts:Stmt* _0 closer:'}'? tail:(_0 @Eos)? {
    if (!closer) {
      pushDiagnostic(shortenRange(location(), 1), 'Unterminated block statement.', DiagnosticSeverity.Error);
    }
    const obj: any = {
      type: 'BlockStatement',
      body: stmts ? stmts : [],
    };
    if (tail) {
      obj.trailingComments = [tail];
    }
    return obj;
  }


// ## FLOW STATEMENTS

/**
 * <BNF> if ( expression ) statement
 * <BNF> if ( expression ) statement else statement
 */
IfStmt 'if statement' =
  test:(
    'if' _0 @(
      '(' _0 test:ExprForceSingle? _0 closer:')'? {
        if (!test) {
          pushDiagnostic(location(), 'The test expression of if-statement must not be empty.', DiagnosticSeverity.Error);
        } else if (!closer) {
          pushDiagnostic(shortenRange(location(), 1), 'Unterminated parenthesis.', DiagnosticSeverity.Error);
        }
        return test;
      }
    )
    /
    ('ifd' / 'ifp') { return NULL_EXPRESSION; }
  ) _0 (Eol / LineComment)? cons:(
    cons:NonemptyStmt? {
      if (!cons) {
        pushDiagnostic(location(), 'The consequent clause of if-statement must not be empty.', DiagnosticSeverity.Error);
      }
      return cons;
    }
  ) alt:(
    _0 'else' !Word _0 (Eol / LineComment)? @(
      alt:NonemptyStmt? {
        if (!alt) {
          pushDiagnostic(location(), 'The altanative clause of if-statement must not be empty.', DiagnosticSeverity.Error);
        }
        return alt;
      }
    )
  )? {
    return { type: 'IfStatement', test: test, consequent: cons, alternate: alt, };
  }

/**
 * <BNF> while ( experssion ) statement
 */
WhileStmt 'while statement' =
  'while' _0 test:(
    '(' _0 test:ExprForceSingle? _0 closer:')'? _0 (Eol / LineComment)? {
      if (!test) {
        pushDiagnostic(shortenRange(location(), 1), 'The test expression of while-statement must not be empty.', DiagnosticSeverity.Error);
      } else if (!closer) {
        pushDiagnostic(shortenRange(location(), 1), 'Unterminated parenthesis.', DiagnosticSeverity.Error);
      }
      return test;
    }
  ) body:(
    body:NonemptyStmt? {
      if (!body) {
        pushDiagnostic(location(), 'The body of while-statement must not be empty.', DiagnosticSeverity.Error);
      }
      return body;
    }
  ) {
    return { type: 'WhileStatement', test: test, body: body, };
  }
  
/**
 * <BNF> for ( expr_opt; expr_opt; expr_opt ) statement
 * <BNF> for (identifier in assoc-array ) statement
 * While the first and third expression in a regular for-loop can be comma-separated expressions,
 * the second expression must be a single expression.
 */
ForStmt 'for statement' =
  'for' _0 stmt:(
    '(' _0 stmt:(
      init:ExprSingleList? _0 ';' _0 test:ExprForceSingle? _0 ';' _0 update:ExprSingleList? {
        return { type: 'ForStatement', init: makeSequenceExpression(init), test: test, update: makeSequenceExpression(update), };
      }
      /
      ll:Identifier _0 'in' !Word _0 rr:AssocArray {
        return { type: 'ForInStatement', left: ll, right: rr, each: false, };
      }
    ) _0 closer:')'? {
      if (!closer) {
        pushDiagnostic(shortenRange(location(), 1), 'Unterminated parenthesis.', DiagnosticSeverity.Error);
      }
      return stmt;
    }
  ) _0 (Eol / LineComment)? body:(
    body:NonemptyStmt? {
      if (!body) {
        pushDiagnostic(location(), 'The body of for-statement must not be empty.', DiagnosticSeverity.Error);
      }
      return body;
    }
  ) {
    stmt.body = body;
    return stmt;
  }

/**
 * <BNF> break [;]
 */
BreakStmt 'break statement' =
  'break' _0 Eos {
    return { type: 'BreakStatement', label: null, };
  }

/**
 * <BNF> continue [;]
 */
ContinueStmt 'continue statement' =
  'continue' _0 Eos {
    return { type: 'ContinueStatement', label: null, };
  }

/**
 * <BNF> return [expression] [;]
 * <NOTICE> not documented in Grammar Rules.
 */
ReturnStmt 'return statement' =
  'return' !Word _0 p:ExprSingle? _0 Eos {
    return { type: 'ReturnStatement', argument: p, };
  }

/**
 * <BNF> exit [;]
 * <NOTICE> no correspondence item in Parser AST.
 * Currently not used.
 */
ExitStmt 'exit statement' =
  'exit' _0 Eos {
    return { type: 'ExitStatement', };
  }


 // ## DECLARATIONS

/**
 * <BNF> def identifier string-constant [;]
 *
 * body in FunctionDeclaration in the Parser AST must be BlockStatement or Expression.
 * params in FunctionDeclaration in the Parser AST must not be null.
 */
MacroDef 'macro declaration' =
  'def' _1 id:IdentifierValidated _0 params:(
    '(' _0 params:IdListItem* _0 closer:')'? _0 {
      if (!closer) {
        pushDiagnostic(shortenRange(location(), 1), 'Unterminated parenthesis.', DiagnosticSeverity.Error);
      }
      return params ? diagnoseListItems(params, 'identifier', 1) : [];
    }
  )?
  _0 body:(
    opener:QuotationMark
    & {
      const flag = testIfQuoteIsAvailable(opener);
      if (flag) { _quoteStack.push(opener); }
      return flag;
    }
    _0 Eos? body:Stmt*
    closer:QuotationMark?
    & {
      // console.log(location(), text());
      const flag = (!closer || opener === closer);
      if (flag) { _quoteStack.pop(); }
      return flag;
    }
    _0 Eos {
      if (!closer) {
        pushDiagnostic(shortenRange(location(), opener.length), 'Unterminated macro definition.', DiagnosticSeverity.Error);
      }
      return body;
    }
    / body:Stmt? _0 Eos {
      pushDiagnostic(shortenRange(location(), 1), 'Expected macro definition body, which must be embraced with quotes.', DiagnosticSeverity.Error);
      return body;
    }
  ) {
    return {
      type: 'FunctionDeclaration',
      id: id,
      params: params,
      // defaults: [ Expression ],
      // rest: Identifier | null,
      body: body,
      generator: false,
      expression: false,
    };
  }

IdListItem =
  id:IdentifierValidated sep:ListSep? {
    return [id, sep, location()];
  }
  / sep:ListSep {
    return [undefined, sep, location()];
  }

/**
 * <BNF> undef identifier-list [;]
 */
UndefStmt 'undef statement' =
  'undef' _1 items:(
    items:IdListItem* {
      diagnoseEmptyArray(items, location(), 'identifier', DiagnosticSeverity.Error);
      return items;
    }
  ) _0 Eos {
    const nodes = diagnoseListItems(items, 'identifier', 0);
    return {
      type: 'MacroStatement',
      callee: { type: 'Identifier', name: 'undef', },
      arguments: nodes,
    };
  }

/**
 * <BNF> rdef identifier expression [;]
 */
RdefStmt 'rdef statement' =
  'rdef' _1 p:(
    id:IdentifierValidated _0 params:(
      '(' _0 params:IdListItem* _0 closer:')'? _0 {
        if (!closer) {
          pushDiagnostic(shortenRange(location(), 1), 'Unterminated parenthesis.', DiagnosticSeverity.Error);
        }
        return params ? diagnoseListItems(params, 'identifier', 1) : [];
      }
    )? expr:(
      expr:ExprMulti? {
        if (!expr) {
          pushDiagnostic(location(), `Expected an expression.`, DiagnosticSeverity.Error);
        }
        return expr;
      }
    ) {
      return [id, expr];
    }
  )? _0 Eos {
    if (!p) {
      pushDiagnostic(location(), `Expected following identifier and expression.`, DiagnosticSeverity.Error);
      return INVALID_STATEMENT;
    }
    return {
      type: 'MacroStatement',
      callee: { type: 'Identifier', name: 'rdef', },
      arguments: p,
    };
  }

/**
 * <BNF> local data-array-declaration [;]
 * <BNF> global data-array-declaration [;]
 * <BNF> shared data-array-declaration [;]
 * <BNF> extern shared data-array-declaration [;]
 * <BNF>
 * <BNF> data-array-declaration;
 * <BNF>   array identifier[expression]
 * <BNF>   data-array-type array identifier[expression]
 * <BNF>   array identifier [expression][expression]
 * <BNF>   data-array-type array identifier[expression][expression]
 */

DataArrayDef 'data-array declaration' =
  scope:(@('local' / 'global' / 'shared') _1)? unit:(@DataArrayUnit _1)? 'array' _1 items:DataArrayListItem* _0 Eos {
    return {
      type: 'VariableDeclaration',
      declarations: makeDeclarators(items, location(), 'array identifier', true),
      kind: 'var',
      exType: 'data-array',
      exScope: scope ? scope : undefined,
      exUnit: unit ? unit : undefined,
    };
  }
  /
  'extern' _1 'shared' _1 'array' _1 items:ExternArrayListItem* _0 Eos {
    return {
      type: 'VariableDeclaration',
      declarations: makeDeclarators(items, location(), 'external array identifier', false),
      kind: 'var',
      exType: 'data-array',
      exScope: 'extern',
      exSize: undefined,
    };
  }

DataArrayUnit =
  'string' / 'float' / 'double'
  / 'byte' / 'short' / $('long' '64'?)
  / 'ubyte' / 'ushort' / $('ulong' '64'?)

DataArrayListItem =
  id:IdentifierValidated sizes:(
    _0 p:(
      '[' _0 expr:ExprForceSingle? _0 closer:']'? {
        if (!closer) {
          pushDiagnostic(shortenRange(location(), 1), 'Unterminated bracket.', DiagnosticSeverity.Error);
        } else if (!expr) {
          pushDiagnostic(location(), 'Array size must be sepcified.', DiagnosticSeverity.Error);
          expr = NULL_LITERAL;
        }
        return expr;
      }
    ) { return p; }
  )* init:(
    _0 op:AssignOp _0 term:ExprMulti? {
      if (op !== '=') {
        pushDiagnostic(location(), `Invalid operator: \"${op}\". Only \"=\" is allowed.`, DiagnosticSeverity.Error);
      }
      if (!term) {
        pushDiagnostic(location(), `Expected an expression following \"${op}\" operator.`, DiagnosticSeverity.Error);
        term = NULL_LITERAL;
      } else if (term.type !== 'ObjectExpression' && term.type !== 'ArrayExpression') {
        pushDiagnostic(location(), 'Only array can be assigned.', DiagnosticSeverity.Error);
      }
      return term;
    }
  )? sep:ListSep? {
    if (!sizes || sizes.length === 0) {
      pushDiagnostic(location(), 'Array size must be sepcified.', DiagnosticSeverity.Error);
    }
    return [ id, sep, location(), { exSizes: sizes, init: init } ];
  }
  /
  sep:ListSep {
    return [ undefined, sep, location(), undefined];
  }  

ExternArrayListItem =
  specPid:(
    spec:$Word+ _0 ':' _0 pid:(@$Word+ _0 ':' _0)? {return [spec, pid]; }
  )? id:IdentifierValidated sep:ListSep? {
    const spec = specPid ? specPid[0] : null;
    const pid = specPid ? specPid[1] : null;
    return [id, sep, location(), { exSpec: spec, exPid: pid }];
  }
  /
  sep:ListSep {
    return [undefined, sep, location(), undefined];
  }
    
/**
 * <BNF> local identifier-list [;]
 * <BNF> global identifier-list [;]
 * <BNF> unglobal identifier-list [;]
 */
VariableDef 'variable declaration' =
  scope:('local' / 'global' / 'unglobal') _1 items:VariableListItem* _0 Eos {
    return {
      type: 'VariableDeclaration',
      declarations: makeDeclarators(items, location(), 'variable identifier', scope !== 'unglobal'),
      kind: 'let',
      exScope: scope,
    };
  }

VariableListItem =
  id:IdentifierValidated bracket:(
    _0 @('[' _0 closer:']'? {
      if (!closer) {
        pushDiagnostic(shortenRange(location(), 1), 'Unterminated bracket.', DiagnosticSeverity.Error);
      }
      return true;
    })
  )? init:(
    _0 op:AssignOp _0 term:ExprMulti? {
      if (op !== '=') {
        pushDiagnostic(location(), `Invalid operator: \"${op}\". Only \"=\" is allowed.`, DiagnosticSeverity.Error);
      }
      if (!term) {
        pushDiagnostic(location(), `Expected an expression following \"${op}\" operator.`, DiagnosticSeverity.Error);
        term = NULL_LITERAL;
      }
      return term;
    }
  )? sep:ListSep? {
    return [ id, sep, location(), { exType: bracket !== null ? 'assoc-array' : 'scalar', init: init, } ];
  }
  /
  sep:ListSep {
    return [ undefined, sep, location(), undefined];
  }

/**
 * <BNF> constant identifier expression [;]
 * <BNF> constant identifier = expression [;]
 */
ConstantDef 'constant declaration' =
  'constant' _1 items:(
    id:IdentifierValidated !Word _0 '='? _0 init:ExprMulti? sep:CommaSep? {
      return [id, init, sep, location()];
    }
  )* _0 Eos {
    if (!items || items.length === 0) {
      pushDiagnostic(location(), `Expected following identifier and initial value.`, DiagnosticSeverity.Error);
      return INVALID_STATEMENT;
    }

    const item = items[0];

    if (items.length > 1) {
      pushDiagnostic(location(), `Only single constant can be decleared per statement.`, DiagnosticSeverity.Error);
    } else if (item[2]) {
      pushDiagnostic(location(), `Trailing comma not allowed.`, DiagnosticSeverity.Error);
    } else if (!item[1]) {
      pushDiagnostic(item[3], `Expected initial value.`, DiagnosticSeverity.Error);
      item[1] = NULL_LITERAL;
    }

    return {
      type: 'VariableDeclaration',
      declarations: [
        {
          type: 'VariableDeclarator',
          id: item[0],
          init: item[1],
        },
      ],
      kind: 'const',
    };
  }

/*
 * OTHER STATEMENTS
 */

/**
 * <BNF> delete assoc-elem-list [;]
 * <BNF> delete assoc-array [;]
 *
 * The BNF in the Grammar Rules does not seems described correctly.
 * Deleting associative array without specifying indexes, as shown below, yields a syntax error.
 * > global arr
 * > arr = [1: "foo"];
 * > delete arr
 */
DeleteStmt 'delete statement' =
  'delete' _1 items:(
    items:AssocElemListItem* {
      diagnoseEmptyArray(items, location(), 'associative array', DiagnosticSeverity.Error);
      return items;
    }
   ) _0 Eos {
    const nodes = diagnoseListItems(items, 'associative array', 0);
    return {
      type: 'UnaryExpression',
      operator: 'delete',
      argument: (nodes && nodes.length > 0)? makeSequenceExpression(nodes) : NULL_EXPRESSION,
      prefix: true,
    };
  }

AssocElemListItem =
  node:AssocArray sep:ListSep? {
    return [node, sep, location(), undefined];
  }
  /
  sep:ListSep {
    return [undefined, sep, location(), undefined];
  }

/**
 * <BNF> lscmd pattern-list-opt [;]
 * <BNF> syms pattern-list-opt [;]
 * <BNF> lsdef pattern-list-opt [;]
 * <BNF> prdef pattern-list-opt [;]
 */
PatternStmt =
  name:('lscmd' / 'lsdef' / 'prdef' / 'syms') !Word _0 items:PatternListItem* _0 Eos {
    let nodes: any[] = [];
    if (items && items.length > 0) {
      nodes = diagnoseListItems(items, 'pattern', 2);
    }
    return {
      type: 'MacroStatement',
      callee: { type: 'Identifier', name: name, },
      arguments: nodes,
    };
  }

PatternListItem =
  node:PatternValidated sep:ListSep? {
    return [node, sep, location()];
  }
  /
  sep:ListSep {
    return [undefined, sep, location()];
  }

PatternValidated =
  MacroArgument
  /
  p:StringLiteral {
    pushDiagnostic(location(), 'Expected a pattern.', DiagnosticSeverity.Error);
    return p;
  }
  /
  (!__ !Eos .)+ {
    if (!_patternRegExp.test(text())) {
      pushDiagnostic(location(), 'Expected a pattern.', DiagnosticSeverity.Error);
    }
    return { type: 'literal', value: text(), raw: text(), };
  }

/**
 * <BNF> memstat [;]
 * <BNF> savstate [;]
 * <BNF> reconfig [;]
 * <BNF> getcounts [;]
 * <BNF> move_all [;]
 * <BNF> move_cnt [;]
 * <BNF> sync [;]
 */
BuiltinMacroStmt =
  name:('memstat' / 'savstate' / 'reconfig' / 'getcounts' / 'move_all' / 'move_cnt' / 'sync') _0 Eos {
    return {
      type: 'MacroStatement',
      callee: { type: 'Identifier', name: name, },
      arguments: [],
    };
  }

/**
 * <BNF> expression [;]
 */
ExprStmt 'expression statement' =
  items:ExprMultiList _0 Eos {
    return {
      type: 'ExpressionStatement',
      expression: makeSequenceExpression(items),
    };
  }

/*
 * EXPRESSION
 *
 * The priority of the operators are not documented in the Grammar Rules.
 * Instead, this PEG grammar follows that of C-language (https://en.wikipedia.org/wiki/Order_of_operations).
 * 
 * There are two operators not included in C-language, 'in' operator and empty operator for string concatenation.
 * It seems the priority of string concatenation is higher than that of assignment but
 * lower than that of ternary operators.
 */

/**
 * expression that does not include concatenation.
 *
 * FunctionCall and UpdateExpr must precede lvalue.
 * UpdateExpr must precede UnaryExpr.
 */
ExprSingle 'expression' =
  ExprRule15

/**
 * The core expression rules with operators haiving the 1st and 2nd priorities.
 */
ExprRule2 =
  StringLiteral / NumericLiteral / ArrayLiteral / ExprBlock / FunctionCall
  / UpdateExpr / UnaryExpr
  / LValue / InvalidExpr

/**
 * <BNF> identifier
 *
 * The symbols $1, $2, ... within ordinary macros are replaced by 
 * the arguments with which the macro is invoked.
 * Therefore, it is difficult to gramatically define these symbols.
 * Expediently, this PEG grammar treats them as identifiers.
 */
Identifier 'identifier' =
  StrictIdentifier
  /
  MacroArgument
  /
  op:'@' _0 arg:ExprSingle? {
    if (!arg) {
      pushDiagnostic(location(), `Expected an expression following \"${op}\" operator.`, DiagnosticSeverity.Error);
    }
    return {
      type: 'UnaryExpression',
      operator: '@',
      argument: arg ? arg : NULL_LITERAL,
      prefix: true,
      loc: location()
    };
  }

StrictIdentifier =
  name:$([a-zA-Z_][a-zA-Z0-9_]*) {
    if (_reservedKeywordRegExp.test(name)) {
      pushDiagnostic(location(), `${name} is a reserved keyword.`, DiagnosticSeverity.Error);
    // } else if (name === 'const') {
    //   pushDiagnostic(location(), `Using ${name} for \"constant\"?`, DiagnosticSeverity.Information);
    // } else if (name === 'elseif' || name === 'elif') {
    //   pushDiagnostic(location(), `Using ${name} for \"else if\"?`, DiagnosticSeverity.Information);
    }
    return { type: 'Identifier', name: name, loc: location(), };
  }

MacroArgument =
  name:$('\\'? '$' ('#' / '*' / [0-9]+)) {
    return { type: 'Identifier', name: name, loc: location(), };
  }

// / [a-zA-Z0-9_.+\-*/%!?^~\\]+
IdentifierValidated =
  Identifier / InvalidExpr
  // / [a-zA-Z0-9_.+\-*/%!?^~\\]+ {
  //   pushDiagnostic(location(), 'invalid as an identifier', DiagnosticSeverity.Error);
  //   return {
  //     type: 'Identifier',
  //     name: text(),
  //   };
  // }

/**
 * <BNF> identifier
 * <BNF> identifier[expression]
 * <BNF> identifier[expression][expression]
 *
 * e.g., _foo12, bar[myfunc(a)], bar[], bar[:], bar[:4], bar[2:], bar[1, 2, 3:5], ...
 */
LValue 'left value' =
  id:Identifier arrDims:(_0 @ArrayElem)* {
    return arrDims.reduce((accumulator: any, currentValue: any) => {
      return {
        type: 'MemberExpression',
        object: accumulator,
        property: currentValue,
        computed: true,
      };
    }, id);
  }

ArrayElem =
  _0 '[' _0 item0:SlicableIndex? items1ToN:(
    sep:CommaSep item:SlicableIndex? { return item ? item : NULL_LITERAL; }
  )* _0 closer:']'? {
    if (!closer) {
      pushDiagnostic(shortenRange(location(), 1), 'Unterminated bracket.', DiagnosticSeverity.Error);
    }
    item0 = item0 ? item0 : NULL_LITERAL;
    if (items1ToN && items1ToN.length > 0) {
      return {
        type: 'SequenceExpression',
        expressions: [item0, ...items1ToN],
      };
    } else {
      return item0;
    }
  }

/**
 * respective item of the comma-separated index. It can be:
 * - expression
 * - expression? : expression?
 */
SlicableIndex =
  ll:ExprMulti? _0 ':' _0 rr:ExprMulti? {
    return { type: 'BinaryExpression', operator: ':', left: ll ? ll : NULL_LITERAL, right: rr ? rr : NULL_LITERAL, };
  }
  /
  ExprMulti

// same definition as LValue
AssocArray =
  id:Identifier arrDims:(_0 @ArrayElem)* {
    return arrDims.reduce((accumulator: any, currentValue: any) => {
      return { type: 'MemberExpression', object: accumulator, property: currentValue, computed: true, };
    }, id);
  }

InvalidExpr =
  '{' Eos? _0 stmts:ExprMultiList? _0 '}'? Eos? {
    pushDiagnostic(location(), 'Braces are to bundle statements. Use parentheses "()" for expressions.', DiagnosticSeverity.Error);
    return NULL_EXPRESSION;
  }
  /
  value:$[^#,'"(){}[\];: \t\r\n\\]+ {
    pushDiagnostic(location(), 'Invalid expression. It should be quoted if it is a string.', DiagnosticSeverity.Warning);
    return { type: 'Literal', value: text(), raw: text(), };
  }
// +-*/%^&|=

/**
 * <BNF> string-constant
 *
 * e.g., "foo,\"bar\"\n123", \'foo\'
 */
StringLiteral 'string literal' =
  opener:QuotationMark
  & {
    const flag = testIfQuoteIsAvailable(opener);
    if (flag) { _quoteStack.push(opener); }
    return flag;
  }
  chars:(
    '\\' q:(
      p:[abfnrt'"\\$\n]
      & { return testIfEscapedCharIsAvailable(p); }
        {
          switch (p) {
            case 'a': return '\x07';
            case 'b': return '\b';
            case 'f': return '\f';
            case 'n': return '\n';
            case 'r': return '\r';
            case 't': return '\t';
            case '\\': return '\\';
            case '\'': return '\'';
            case '\"': return '\"';
            case '$': return '$';
            case '\n': return '';
            default: return '';
          }
        }
      /
      p:$([0-7][0-7]?[0-7]?) { return String.fromCharCode(parseInt(p, 8)); }
      /
      p:'[' cmd:$Word+ ']' {
        if (!_ttyCommandRegExp.test(cmd)) {
          pushDiagnostic(location(), `${cmd} is not a TTY command.`, DiagnosticSeverity.Warning);
        }
        return text();
      }
      /
      p:.
      & { return testIfEscapedCharIsAvailable(p); }
        {
          const loc = location();
          loc.start.offset -= 1;
          loc.start.column -= 1;
          pushDiagnostic(loc, 'Unknown escape sequence.', DiagnosticSeverity.Warning);
          return p;
        }
    ) { return q; }
    /
    r:[^\\]
    & { return testIfUnescapedCharIsAvailable(r); }
      {
        if (!testIfEscapedCharIsAvailable(r)) {
          pushDiagnostic(location(), 'Quotation symbol not allowed here.', DiagnosticSeverity.Error);
        }
        return r;
      }
  )*
  closer:QuotationMark? {
    if (!closer) { pushDiagnostic(shortenRange(location(), opener.length), 'Unterminated string literal.', DiagnosticSeverity.Error); }
    _quoteStack.pop();
    return {
      type: 'Literal',
      value: chars.join(''),
      raw: text(),
    };
  }

/** 
 * <BNF> numeric-constant
 *
 * e.g., 0.1, 1e-3, 19, 017, 0x1f
 */
NumericLiteral 'numeric literal' =
  // floating-point
  (([0-9]+ (Exponent / '.' [0-9]* Exponent?)) / '.' [0-9]+ Exponent?) {
    return { type: 'Literal', value: parseFloat(text()), raw: text(), };
  }
  /
  // hexadecimal integer
  '0' [xX] body:$[0-9a-fA-F]+ {
    return { type: 'Literal', value: parseInt(body, 16), raw: text(), };
  }
  /
  // octal integer
  '0' body:$[0-7]+ {
    return { type: 'Literal', value: parseInt(body, 8), raw: text(), };
  }
  /
  // decimal integer
  [0-9]+ {
    return { type: 'Literal', value: parseInt(text(), 10), raw: text(), };
  }

// exponential part in floating-point digit, e.g., E+3 in 1.2E+3)
Exponent =
  [eE] [+-]? [0-9]+

/**
 * Array literals used in assignment operation.
 * its BNF is undocumented in the Grammar Rules.
 * e.g., [var0, 1+2, "test"], ["foo": 0x12, "bar": var1]
 */
ArrayLiteral 'array literal' =
  '[' _0 item0:(
    item:ArrayItem? {
      if (!item) {
        pushDiagnostic(location(), 'Expected an array element.', DiagnosticSeverity.Error);
        return NULL_LITERAL;
      }
      return item;
    }
  ) items1ToN:(
    sep:CommaSep item:ArrayItem? {
      if (!item) {
        pushDiagnostic(location(), 'Expected an array element.', DiagnosticSeverity.Error);
        return NULL_LITERAL;
      }
      return item;
    }
  )* _0 closer:']'? {
    if (!closer) {
      pushDiagnostic(shortenRange(location(), 1), 'Unterminated bracket.', DiagnosticSeverity.Error);
    }
    const items = [item0, ...items1ToN];
    
    if (items.some((item: any) => item === NULL_LITERAL)) {
      return NULL_EXPRESSION;
    // } else if (items.every((item: any) => item.type === 'Property')) {
    //   // every item is a key-value pair.
    //   return {
    //     type: 'ObjectExpression',
    //     properties: items,
    //   };
    // } else if (items.every((item: any) => item.type !== 'Property')) {
    //   // every item is an expression (not a key-value pair).
    //   return {
    //     type: 'ArrayExpression',
    //     elements: items,
    //   };
    } else {
    //     pushDiagnostic(location(), 'Mixture of associate-array and data-array literals not allowed.', DiagnosticSeverity.Error);
    //     return NULL_EXPRESSION;
      return { type: 'ObjectExpression', properties: items, };
    }
  }

/**
 * An item in array-literal, either a colon-separated pair of expressions or a single expression.
 * <NOTICE> While 'key' property must be a 'Literal' or 'Identifier' in the Parser AST,
 * <NOTICE> that of spec can be an 'Expression'.
 */
ArrayItem =
  //  e.g., [ 1: 2: "item", 2: 3: "item2" ]
  key1:ExprMulti? _0 ':' _0 key2:ExprMulti? _0 ':' _0 value:ExprMulti? {
    if (!key1 || !key2) {
      pushDiagnostic(location(), `Expected a key expression.`, DiagnosticSeverity.Error);
    } else if (!value) {
      pushDiagnostic(location(), `Expected a value expression.`, DiagnosticSeverity.Error);
    }
    // Not yet implemented. key2 is not exported!!!
    return {
      type: 'Property',
      key: key1 ? key1 : NULL_LITERAL,
      value: value ? value : NULL_LITERAL,
      kind: 'init',
    };
  }
  /
  //  e.g., [ 0: "item", 1: "item2" ]
  key:ExprMulti? _0 ':' _0 value:ExprMulti? {
    if (!key) {
      pushDiagnostic(location(), `Expected a key expression.`, DiagnosticSeverity.Error);
    } else if (!value) {
      pushDiagnostic(location(), `Expected a value expression.`, DiagnosticSeverity.Error);
    }
    return {
      type: 'Property',
      key: key ? key : NULL_LITERAL,
      value: value ? value : NULL_LITERAL,
      kind: 'init',
    };
  }
  / ExprMulti


/**
 * <BNF> ( expression )
 * Expression in the Parser AST must not be null.
 */
ExprBlock 'parentheses that enclose expression' =
  '(' _0 expr:ExprMulti? _0 closer:')'? {
    if (!expr) {
      pushDiagnostic(location(), `Expected an expression in the parentheses.`, DiagnosticSeverity.Error);
      return NULL_EXPRESSION;
    } else if (!closer) {
      pushDiagnostic(shortenRange(location(), 1), 'Unterminated parenthesis.', DiagnosticSeverity.Error);
    }
    return expr;
  }

/**
 * <BNF> function(expression-list)
 *
 * Respective arguments must be separated with a comma.
 * It seems spec does not allow string concatenation of arguments.
 */
FunctionCall 'function call' =
  expr:StrictIdentifier _0 args:(
    '(' _0 args:ExprSingleList? _0 closer:')'? {
      if (!closer) {
        pushDiagnostic(shortenRange(location(), 1), 'Unterminated parenthesis.', DiagnosticSeverity.Error);
      }
      return args;
    }
  ) {
    return { type: 'CallExpression', callee: expr, arguments: args ? args : [], };
  }


/**
 * <BNF> + expression
 * <BNF> - expression
 * <BNF> ! expression
 * <BNF> ~ expression
 */
UnaryExpr 'unary expression' =
  op:('+' / '-' / '!' / '~') _0 arg:ExprSingle? {
    if (!arg) {
      pushDiagnostic(location(), `Expected an expression following \"${op}\" operator.`, DiagnosticSeverity.Error);
    }
    return { type: 'UnaryExpression', operator: op, argument: arg ? arg : NULL_LITERAL, prefix: true, };
  }

/**
 * <BNF> ++ lvalue
 * <BNF> −− lvalue
 * <BNF> lvalue ++
 * <BNF> lvalue −−
 */
UpdateExpr 'update expression' =
  op:('++' / '--') _0 arg:LValue? {
    if (!arg) {
      pushDiagnostic(location(), `Expected an lvalue following \"${op}\" operator.`, DiagnosticSeverity.Error);
    }
    return { type: 'UpdateExpression', operator: op, argument: arg ? arg : NULL_LITERAL, prefix: true, };
  }
  / arg:LValue _0 op:('++' / '--') {
    return { type: 'UpdateExpression', operator: op, argument: arg, prefix: false, };
  }

/**
 * <BNF> expression binop expression
 * 3rd priority: * / %
 */
ExprRule3 =
  head:ExprRule2 tails:(
    _0 op:$(('*' / '/' / '%') !'=') _0 term:ExprRule2? {
      if (!term) {
        pushDiagnostic(location(), `Expected an expression following \"${op}\" operator.`, DiagnosticSeverity.Error);
        term = NULL_LITERAL;
      }
      return [op, term];
    }
  )* {
    return getBinaryExpression(head, tails);
  }

/**
 * <BNF> expression binop expression
 * 4th priority: + -
 */
ExprRule4 =
  head:ExprRule3 tails:(
    _0 op:$(('+' / '-') !'=') _0 term:ExprRule3? {
      if (!term) {
        pushDiagnostic(location(), `Expected an expression following \"${op}\" operator.`, DiagnosticSeverity.Error);
        term = NULL_LITERAL;
      }
      return [op, term];
    }
  )* {
    return getBinaryExpression(head, tails);
  }

/**
 * <BNF> expression binop expression
 * 5th priority: << >>
 */
ExprRule5 =
  head:ExprRule4 tails:(
    _0 op:$(('<<' / '>>') !'=') _0 term:ExprRule4? {
      if (!term) {
        pushDiagnostic(location(), `Expected an expression following \"${op}\" operator.`, DiagnosticSeverity.Error);
        term = NULL_LITERAL;
      }
      return [op, term];
    }
  )* {
    return getBinaryExpression(head, tails);
  }

/**
 * <BNF> expression binop expression
 * 6th priority: < <= > >=
 */
ExprRule6 =
  head:ExprRule5 tails:(
    _0 op:($('<' !'<' '='?) / $('>' !'>' '='?)) _0 term:ExprRule5? {
      if (!term) {
        pushDiagnostic(location(), `Expected an expression following \"${op}\" operator.`, DiagnosticSeverity.Error);
        term = NULL_LITERAL;
      }
      return [op, term];
    }
  )* {
    return getBinaryExpression(head, tails);
  }

/**
 * <BNF> expression binop expression
 * 7th priority: == !=
 */
ExprRule7 =
  head:ExprRule6 tails:(
    _0 op:('==' / '!=') _0 term:ExprRule6? {
      if (!term) {
        pushDiagnostic(location(), `Expected an expression following \"${op}\" operator.`, DiagnosticSeverity.Error);
        term = NULL_LITERAL;
      }
      return [op, term];
    }
  )* {
    return getBinaryExpression(head, tails);
  }

/**
 * <BNF> expression binop expression
 * 8th priority: &
 */
ExprRule8 =
  head:ExprRule7 tails:(
    _0 op:$('&' ![&=]) _0 term:ExprRule7? {
      if (!term) {
        pushDiagnostic(location(), `Expected an expression following \"${op}\" operator.`, DiagnosticSeverity.Error);
        term = NULL_LITERAL;
      }
      return [op, term];
    }
  )* {
    return getBinaryExpression(head, tails);
  }

/**
 * <BNF> expression binop expression
 * 9th prioirity: ^
 */
ExprRule9 =
  head:ExprRule8 tails:(
    _0 op:$('^' !'=') _0 term:ExprRule8? {
      if (!term) {
        pushDiagnostic(location(), `Expected an expression following \"${op}\" operator.`, DiagnosticSeverity.Error);
        term = NULL_LITERAL;
      }
      return [op, term];
    }
  )* {
    return getBinaryExpression(head, tails);
  }

/**
 * <BNF> expression binop expression
 * 10th prioirity: |
 */
ExprRule10 =
  head:ExprRule9 tails:(
    _0 op:$('|' ![|=]) _0 term:ExprRule9? {
      if (!term) {
        pushDiagnostic(location(), `Expected an expression following \"${op}\" operator.`, DiagnosticSeverity.Error);
        term = NULL_LITERAL;
      }
      return [op, term];
    }
  )* {
    return getBinaryExpression(head, tails);
  }

/**
 * <BNF> expression binop expression
 * 11th prioirity: &&
 */
ExprRule11 =
  head:ExprRule10 tails:(
    _0 op:'&&' _0 term:ExprRule10? {
      if (!term) {
        pushDiagnostic(location(), `Expected an expression following \"${op}\" operator.`, DiagnosticSeverity.Error);
        term = NULL_LITERAL;
      }
      return [op, term];
    }
  )* {
    return getBinaryExpression(head, tails, 1);
  }

/**
 * <BNF> expression binop expression
 * 12th prioirity: ||
 */
ExprRule12 =
  head:ExprRule11 tails:(
    _0 op:'||' _0 term:ExprRule11? {
      if (!term) {
        pushDiagnostic(location(), `Expected an expression following \"${op}\" operator.`, DiagnosticSeverity.Error);
        term = NULL_LITERAL;
      }
      return [op, term];
    }
  )* {
    return getBinaryExpression(head, tails, 1);
  }

/*
 * <BNF> expression ? expression : expression
 * 13th priority: ? :
 */
ExprRule13 =
  head: ExprRule12 tails:(
    _0 '?' _0 cons:ExprRule12? _0 alt:(':' _0 @ExprRule12?)? {
      if (!alt) {
        pushDiagnostic(location(), 'Expected an altenative expression following \":\" opearator.', DiagnosticSeverity.Error);
        alt = NULL_LITERAL;
      } else if (!cons) {
        pushDiagnostic(location(), 'Expected a consequent expression following \"?\" opearator.', DiagnosticSeverity.Error);
        cons = NULL_LITERAL;
      }
      return [cons, alt];
    }
  )* {
    return tails.reduce((accumulator: any, currentValue: any) => {
      const cons = currentValue[0];
      const alt = currentValue[1];
      return { type: 'ConditionalExpression', test: accumulator, left: cons, right: alt, };
    }, head);
  }

/*
 * <BNF> lvalue asgnop expression
 * 14th priority: = += -= *= /= %= &= |= ^= <<= >>=
 */
ExprRule14 =
  head:ExprRule13 tail:(
    _0 op:AssignOp _0 term:ExprMulti? {
      if (!term) {
        pushDiagnostic(location(), `Expected an expression following \"${op}\" operator.`, DiagnosticSeverity.Error);
        term = NULL_LITERAL;
      }
      return [op, term];
    }
  )? {
    if (!tail) {
      return head;
    } else {
      if (head.type !== 'Identifier' && head.type !== 'MemberExpression') {
        pushDiagnostic(location(), 'Left-side value must be assignable.', DiagnosticSeverity.Error);
      }
      const op = tail[0];
      const term = tail[1];
      return { type: 'AssignmentExpression', operator: op, left: head, right: term, };
    }
  }

// assignment operator
AssignOp =
  $('=' !'=') / '+=' / '-=' / '*=' / '/=' / '%='
  / '<<=' / '>>=' / '&=' / '^=' / '|='

/*
 * <15th priority> in
 * <BNF> expression in assoc-array
 * 
 * Though not documented, it seems 'in' operator has lower priority than assignment operators.
 *  > myvar = "key" in assoc_array; print myvar
 * returns "key".
 */
ExprRule15 =
  head:ExprRule14 tails:(
    _0 op:'in' !Word _0 term:AssocArray? {
      if (!term) {
        pushDiagnostic(location(), `Expected an associative array following \"${op}\" operator.`, DiagnosticSeverity.Error);
      }
      return [op, term];
    }
  )* {
    return getBinaryExpression(head, tails);
  }

/*
 * <The last priority> concatenation
 * <BNF> expression expression
 * 
 * expression that includes concatenation (e.g., "1" "2" yields "12")
 * Though not documented in the Grammar Rules, this rule can be
 * used in limited contexts of the expression.
 */
ExprMulti =
  head:ExprSingle tails:(
    spaces:_0 term:ExprSingle {
      if (!spaces || spaces.length === 0) {
        pushDiagnostic(location(), 'Expressions should be separated with whitespace.', DiagnosticSeverity.Information);
      }
      return [' ', term];
    }
  )* {
    return getBinaryExpression(head, tails);
  }

/**
 * This rule allow concatenation of the expression like ExprMulti but 
 * throws an error.
 */
ExprForceSingle =
  head:ExprSingle tails:(
    _0 tail:ExprSingle {
      pushDiagnostic(location(), 'Expression concatenation not allowed.', DiagnosticSeverity.Error);
      return [' ', tail];
    }
  )* {
    return getBinaryExpression(head, tails);
  }

/*
 * BNF> expression, expression
 * Though these are recursively defined as 'expression' in the Grammar Rules, 
 * the spec interpretter sometimes treats them differently.
 * For example, a = 1, b = 2 can not be used for the test expression in if-clause
 * (though it is written "if (expression) statement" in the Grammar Rules).
 */

/**
 * Comma-separated expression list in which concatenation of the expressions is not allowed.
 */
ExprSingleList 'comma-separated expression list' =
  item0:ExprForceSingle items1ToN:_ExprSingleListItem* {
    return [item0, ...items1ToN];
  }
  /
  items1ToN:_ExprSingleListItem+ {
    pushDiagnostic(shortenRange(location(), 0), 'Expected an expression.', DiagnosticSeverity.Error);
    return [NULL_LITERAL, ...items1ToN];
  }

_ExprSingleListItem =
  CommaSep item:ExprForceSingle? {
    if (!item) {
      pushDiagnostic(location(), 'Expected an expression.', DiagnosticSeverity.Error);
      return NULL_LITERAL;
    }
    return item;
  }

/**
 * Comma-separated expression list in which concatenation of the expressions is also allowed.
 */
ExprMultiList 'comma-separated expression list' =
  item0:ExprMulti items1ToN:_ExprMultiListItem* {
    return [item0, ...items1ToN];
  }
  /
  items1ToN:_ExprMultiListItem+ {
    pushDiagnostic(shortenRange(location(), 0), 'Expected an expression.', DiagnosticSeverity.Error);
    return [NULL_LITERAL, ...items1ToN];
  }

_ExprMultiListItem =
  CommaSep item:ExprMulti? {
    if (!item) {
      pushDiagnostic(location(), 'Expected an expression.', DiagnosticSeverity.Error);
      return NULL_LITERAL;
    }
    return item;
  }
