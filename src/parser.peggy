/** 
 * This file defines the rules for parsing spec command files in Peggy.js (https://peggyjs.org) syntax.
 * 
 * A JavaScript file generated from this file parses a spec command file and
 * outputs a JavaScript object that resembles Node objects the _Parser AST_
 * produces.
 * link: https://web.archive.org/web/20210314002546/https://developer.mozilla.org/en-US/docs/Mozilla/Projects/SpiderMonkey/Parser_API
 */

{{
// @ts-check
// The line above is a special line that lets the JavaScript file be 
// type-checked. However, it seems Peppy.js does not allow to insert this line
// at the top of an output JavaScript file.
// To let the code be type-checked, instead one can use `checkJs` compiler
// option to true typically via tsconfig.json.

import { DiagnosticSeverity, l10n } from 'vscode';

// /** @enum {number} */
// const DiagnosticSeverity = {
//   Error: 0,
//   Warning: 1,
//   Information: 2,
//   Hint: 3,
// };

/**
 * JSDoc annotation for type checking.
 * @typedef { import('./parser').LocationRange } LocationRange
 * @typedef { import('./parser').Location } Location
 * @typedef { import('./parser').GrammarSource } GrammarSource

 * @typedef { import('./tree').Statement } Statement
 * @typedef { import('./tree').Expression } Expression
 * @typedef { import('./tree').Literal } Literal
 * @typedef { import('./tree').Identifier } Identifier
 * @typedef { import('./tree').MacroParameter } MacroParameter
 * @typedef { import('./tree').EmptyStatement } EmptyStatement
 * @typedef { import('./tree').SequenceExpression } SequenceExpression
 * @typedef { import('./tree').BinaryOperator } BinaryOperator
 * @typedef { import('./tree').BinaryExpression } BinaryExpression
 * @typedef { import('./tree').LogicalOperator } LogicalOperator
 * @typedef { import('./tree').LogicalExpression } LogicalExpression
 */

const RESERVED_KEYWORD_REGEXP = new RegExp(
  '^('
  + 'def|rdef|constant|local|global|un(?:def|global)|delete|shared|extern|array|'
  + 'float|double|string|u?(?:byte|short|long(?:64)?)|'
  + 'if|else|while|for|in|break|continue|exit|return|quit|'
  + 'memstat|savstate|reconfig|getcounts|move_(?:all|cnt)|sync|ls(?:cmd|def)|prdef|syms|'
  + 'print|eprint|history'
  + ')$'
);

const TTY_COMMAND_REGEXP = /^(c(?:d|e)|do|ho|le|m(?:b|d|e|h|r)|nd|s(?:e|o)|u(?:e|p|s))$/;
// const SYMBOL_MATCH_REGEXP = /^(?:[a-zA-Z0-9_*?]|\[\^?(?:[a-zA-Z0-9_](?:\-[a-zA-Z0-9_])?)+\])+$/;

const DOCSTRING_LABEL = l10n.t('docstring');
const BLOCK_STMT_LABEL = l10n.t('block statement');
const MACRO_DEF_LABEL = l10n.t('macro definition');
const ASSOC_ARRAY_LABEL = l10n.t('associative array');
const ARGUMENT_LABEL = l10n.t('argument');
const BRACKET_LABEL = l10n.t('bracket');
const STRING_LITERAL_LABEL = l10n.t('string literal');
const ARRAY_ELEMENT_LABEL = l10n.t('array element');
const ARRAY_INDEX_LABEL = l10n.t('array index');
const PAREN_LABEL = l10n.t('parenthesis');
const FUNC_ARGUMENT_LABEL = l10n.t('function argument');
const EXPR_LABEL = l10n.t('expression');
const FUNC_PARAM_LIST_LABEL = l10n.t('list of function parameters');
const TEST_IN_IF_LABEL = l10n.t('test expression in if-statement');
const CONSEQUENT_IN_IF_LABEL = l10n.t('consequent clause in if-statement');
const ALTERNATIVE_IN_IF_LABEL = l10n.t('alternative clause in if-statement');
const TEST_IN_WHILE_LABEL = l10n.t('test expression in while-statement');
const BODY_IN_WHILE_LABEL = l10n.t('body in while-statement');
const TEST_IN_FOR_LABEL = l10n.t('test expression in for-statement');
const BODY_IN_FOR_LABEL = l10n.t('body in for-statement');
const EXPR_IN_PAREN_LABEL = l10n.t('expression in the parenthesis');

// There is a peggy.js's built-in `offset()` function.
// For safety, `offset` is not used as a name of a function parameter or a variable.

/**
 * Return a new range object based on the range.
 * @param {GrammarSource} source - The source of the grammar.
 * @param {Location} baseLoc - The base location to be referenced.
 * @param {number} [len=0] - The length of the range.
 * @param {number} [off=0] - The offset to be added to the base location.
 * @returns {LocationRange} - The modified location range.
 */
function getRangeFromLocation(source, baseLoc, len = 0, off = 0) {
  const start = shiftLocationColumn(baseLoc, off);
  const end = shiftLocationColumn(start, len);
  return { source, start, end };
}

/**
 * Return a new location object.
 * @param {Location} loc - The base location to be referenced.
 * @param {number} shift - how many columns to shift.
 * @returns {Location} - The modified location.
 */
function shiftLocationColumn(loc, shift) {
  return { line: loc.line, column: loc.column + shift, offset: loc.offset + shift, };
}
}}

{
  /** @type { { message: string, loc: LocationRange, severity: DiagnosticSeverity, }[] } */
  const _problems = [];
  /** @type { string[] } */
  const _quoteStack = [];

  /**
   * create diagnostic object and store it.
   * @param {string} message - error message
   * @param {LocationRange} [loc=location()] - location range
   * @param {number} [severity=DiagnosticSeverity.Error] - error severity
   * @returns {void}
   */
  function pushDiagnostic(message, loc = location(), severity = DiagnosticSeverity.Error) {
    _problems.push({ message, loc, severity });
  }

  /**
   * create a null literal.
   * @param {LocationRange} [loc=location()] - location range
   * @returns { {type: 'Literal', value: null, loc: LocationRange, } }
   */
  function getNullLiteral(loc = location()) {
    return { type: 'Literal', value: null, loc, };
  }

  /**
   * Report an error if closer does not exist.
   * @param {string | null | undefined} closer - closer string
   * @param {string} label - label of the error
   * @param {LocationRange} loc - The base location to be referenced. End position is not used.
   * @param {number} [openerLength=1] - length of the opener string
   * @param {number} [severity=DiagnosticSeverity.Error] - error severity
   * @returns {void}
   */
  function diagnoseIfNotClosed(closer, label, loc, openerLength = 1, severity = DiagnosticSeverity.Error) {
    if (!closer) {
      pushDiagnostic(l10n.t('Unterminated {0}.', label), getRangeFromLocation(loc.source, loc.start, openerLength), severity);
    }
  }

  /**
   * Report an error if the object is empty.
   * @template {Expression} T
   * @param {T | null | undefined} obj - object to be checked
   * @param {string} label - label of the error
   * @param {LocationRange | undefined} [loc=undefined] - location range of the error
   * @param {number} [severity=DiagnosticSeverity.Error] - error severity
   * @returns {T | Literal} - the object itself if it is not empty, otherwise a 'Literal' object whose value is null.
   */
  function diagnoseNullishExpression(obj, label, loc = undefined, severity = DiagnosticSeverity.Error) {
    if (!obj) {
      const loc2 = loc ?? location();
      pushDiagnostic(l10n.t('Expected {0}.', label), loc2, severity);
      return { type: 'Literal', value: null, loc: loc2, };
    }
    return obj;
  }

  /**
   * Report an error if the object is empty.
   * @template {Expression} T
   * @param {T | null | undefined} obj - object to be checked
   * @param {string} op - operator string
   * @param {number} [off=0] - how many columns to shift the location of the error
   * @param {LocationRange | undefined} [loc=undefined] - location range of the error
   * @param {number} [severity=DiagnosticSeverity.Error] - error severity
   * @returns {T | Literal} - the object itself if it is not empty, otherwise a 'Literal' object whose value is null.
   */
  function diagnoseNoOperatorFollower(obj, op, off = 0, loc = undefined, label = l10n.t('expression'), severity = DiagnosticSeverity.Error) {
    if (!obj) {
      const baseLoc = loc ?? location();
      const locOp = getRangeFromLocation(baseLoc.source, baseLoc.start, op.length, off);
      const locObj = getRangeFromLocation(baseLoc.source, baseLoc.start, 0, off + op.length);
      pushDiagnostic(l10n.t('Expected {0} following "{1}" operator.', label, op), locOp, severity);
      return { type: 'Literal', value: null, loc: locObj, };
    }
    return obj;
  }

  /**
   * Report an error if the object is empty.
   * @template {Statement} T
   * @param {T | null | undefined} obj - object to be checked
   * @param {string} label - label of the error
   * @param {LocationRange | undefined} [loc=undefined] - location range of the error
   * @param {number} [severity=DiagnosticSeverity.Error] - error severity
   * @returns {T | EmptyStatement} - the object itself if it is not empty, otherwise an 'EmptyStatement' object.
   */
  function diagnoseNullishStatement(obj, label, loc = undefined, severity = DiagnosticSeverity.Error) {
    if (!obj) {
      const loc2 = loc ?? location();
      pushDiagnostic(l10n.t('Expected {0}.', label), loc2, severity);
      return { type: 'EmptyStatement', loc: loc2, };
    }
    return obj;
  }

  /**
   * Report an error if a element in the array is nullish or a null literal.
   * @template {Expression} T
   * @param {Array<T>} expressions - expressions to be checked
   * @param {string} label - label of the error
   * @param {number} [severity=DiagnosticSeverity.Error] - error severity
   * @returns {Array<T>} - the array itself after nullish elements are removed.
   */
  function diagnoseNullishElementInArray(expressions, label, severity = DiagnosticSeverity.Error) {
    return expressions.filter(expression => {
      if (!expression) {
        const loc = location();
        pushDiagnostic(l10n.t('Expected {0}.', label), loc, severity);
        return false;
      } else if (expression.type === 'Literal' && expression.value === null) {
        pushDiagnostic(l10n.t('Expected {0}.', label), expression.loc ?? location(), severity);
      }
      return true;
    });
  }

  // TODO: review code
  /**
   * Make a sequence expression from array.
   * If an array is empty or null, null is returned.
   * If an array has only one Expression, it returns the Expression itself (not array).
   * If an array has two or more expressions, it returns a Sequence Expression containing the elements.
   * @template {Expression} T
   * @param {Array<T> | null} expressions - array of expressions
   * @returns {SequenceExpression | T | null} - SequenceExpression, object or null
   */
  function makeSequenceExpression(expressions) {
    if (expressions === null || expressions.length === 0) {
      return null;
    } else if (expressions.length === 1) {
      return expressions[0];
    } else {
      diagnoseNullishElementInArray(expressions, EXPR_LABEL);
      return { type: 'SequenceExpression', expressions, loc: location(), };
    }
  }

  /**
   * Make nested expression for binary operation.
   * head must be an expression. tails must be [string, any]
   * @param {Expression} head - head expression
   * @param {[BinaryOperator, Expression][]} tails - array of [operator (string), term (any)]
   * @returns {BinaryExpression | Expression} - If tails is not empty returns BinaryExpression. Else return head itself.
   */
  function getBinaryExpression(head, tails) {
    return tails.reduce((accumulator, currentValue) => {
      const [operator, right] = currentValue;
      return { type: 'BinaryExpression',  operator, left: accumulator, right, loc: location(), };
    }, head);
  }

  /**
   * Make nested expression for binary operation.
   * head must be an expression. tails must be [string, any]
   * @param {Expression} head - head expression
   * @param {[LogicalOperator, Expression][]} tails - array of [operator (string), term (any)]
   * @returns {LogicalExpression | Expression} - If tails is not empty returns LogicalExpression. Else return head itself.
   */
  function getLogicalExpression(head, tails) {
    return tails.reduce((accumulator, currentValue) => {
      const [operator, right] = currentValue;
      return { type: 'LogicalExpression',  operator, left: accumulator, right, loc: location(), };
    }, head);
  }

  /**
   * @param {string} opener - characters to open a quotation
   * @return {boolean} - true if the quotation is started
   */
  function testIfQuoteStarts(opener) {
    if (opener === '"' && (_quoteStack.includes('"') || _quoteStack.includes('\\"'))) {
      return false;
    } else if (opener === "'" && (_quoteStack.includes("'") || _quoteStack.includes("\\'"))) {
      return false;
    } else if (opener === '\\"' && _quoteStack.includes('\\"')) {
      return false;
    } else if (opener === "\\'" && _quoteStack.includes("\\'")) {
      return false;
    } else {
      _quoteStack.push(opener);
      return true;
    }
  }

  /**
   * @param {string} opener - characters to open a quotation
   * @param {string | undefined} closer - characters to close a quotation
   * @return {boolean} - true if the quotation is terminated
   */
  function testIfQuoteEnds(opener, closer) {
    const flag = (!closer || opener === closer);
    if (flag) { _quoteStack.pop(); }
    return flag;
  }

  /**
   * @param {string} escapedChar - character to be escaped
   * @return {boolean} - true if the escaped character is not available
   */
  function testIfEscapedCharIsAvailable(escapedChar) {
    return _quoteStack.every(quote => quote.length !== 2 || quote.substring(1, 2) !== escapedChar);
  }

  /**
   * @param {string} unescapedChar - character to be unescaped
   * @return {boolean} - true if the unescaped character is not available
   */
  function testIfUnescapedCharIsAvailable(unescapedChar) {
    return _quoteStack.every(quote => quote.length !== 1 || quote !== unescapedChar);
  }
}

// # MAIN

Start =
  body:Stmt* {
    return { type: 'Program', body, problems: _problems, };
  }

// # AUXILIARIES

_Eol 'end of line' = '\n' / '\r\n'
_Eof 'end of file' = !.

// TODO: review code
LineComment 'line comment' =
  @(
    '#' p:$(
      !_Eol (
        !_QuotMark .
        /
        q:. !{ return _quoteStack.includes(q); }
      )
    )* {
      return { type: 'Line', value: p, loc: location(), };
    }
  ) (_Eol / Eos0)

_QuotMark 'quotation mark' = $('\\'? ('"' / "'"))

Eos0 = _Eof { } / &_QuotMark { } / &'}' { }
Eos1 = _Eol { } / LineComment / ';' ([ \t]* _Eol)? { } 
Eos 'end of statement' = Eos1  / Eos0

BlockComment 'block comment' =
  '"""' value:$(!'"""' .)* closer:'"""'? {
    const loc = location();
    diagnoseIfNotClosed(closer, DOCSTRING_LABEL, loc, 3);
    return { type: 'Block', value, loc, };
  }

__ 'whitespace' =
  $(' ' / '\t' / '\\' _Eol / BlockComment {
    pushDiagnostic(l10n.t('Inline docstring not recommended.'), location(), DiagnosticSeverity.Information);
    return text();
  })

_1 'whitespaces'          = $__+
_0 'optional whitespaces' = $__*

_Word = [a-zA-Z0-9_]


_DelimComma =
  _0 ',' _0

_DelimCommaWLoc =
  _0 loc:(','  { return location(); }) _0 { return { loc, }; }

_LooseDelim = 
  _DelimComma / _1

_LooseDelimComma = 
  _DelimComma
  /
  _1 &_Word { pushDiagnostic(l10n.t('Separator must be a comma.'), location(), ); }

_LooseDelimSpace =
  l:_DelimCommaWLoc { pushDiagnostic(l10n.t('Separator must be a whitespace.'), l.loc); }
  /
  @_1 &_Word

// # STATEMENTS
 
 /**
  * BNF> statement
  * Statement with or without leading comments.
  */
Stmt 'statement' =
  comments:LeadingComment+ stmt:(_0 @(EmptyStmt1 / NonemptyStmt / EmptyStmt0)) {
    if (comments && comments.length > 0) {
      stmt.leadingComments = comments;
    }
    return stmt;
  }
  /
  _0 @(EmptyStmt1 / NonemptyStmt)
  /
  _1 @EmptyStmt0

/**
 * Empty line containing only whitespaces and a line or block comment,
 * which is treated as the leading comments of the succeeding statement.
 */
LeadingComment 'empty statement with comment' =
  [ \t]* @(LineComment / @BlockComment [ \t]* (_Eol / Eos0))

EmptyStmt1 =
  Eos1 {
    const loc = location();
    return { type: 'EmptyStatement', loc: getRangeFromLocation(loc.source, loc.start), };
  }

EmptyStmt0 =
  Eos0 { return { type: 'EmptyStatement', loc: location(), }; }

/**
 * Nonempty statement.
 */
NonemptyStmt 'nonempty statement' =
  stmt:(
    BlockStmt
    / IfStmt / WhileStmt / ForStmt / BreakStmt / ContinueStmt / ReturnStmt / ExitStmt / QuitStmt
    / MacroDef / UndefStmt / DArrayDef / VariableDef / ConstantDef
    / DeleteStmt / MatchStmt / MacroStmt / ExprStmt
  ) {
    if (!stmt.loc) {
      stmt.loc = location();
    }
    return stmt;
  }

/**
 * <BNF> compound-statement:
 *         { statement-list }
 */
BlockStmt 'block statement' =
  stmt:(
    '{' _0 Eos?
    body:Stmt*
    _0 closer:'}'? {
      const loc = location();
      diagnoseIfNotClosed(closer, BLOCK_STMT_LABEL, loc);
      return { type: 'BlockStatement', body, loc, };
    }
  ) tail:(_0 @Eos)? {
    if (tail) {
      stmt.trailingComments = [tail];
    }
    return stmt;
  }


// ## FLOW STATEMENTS

/**
 * <BNF> if ( expression ) statement
 * <BNF> if ( expression ) statement else statement
 */
IfStmt 'if statement' =
  test:(
    'if' _0 '(' _0 expr:ExprForceSingle? _0 closer:')'? {
        const loc = location();
        diagnoseIfNotClosed(closer, TEST_IN_IF_LABEL, loc);
        return diagnoseNullishExpression(expr, TEST_IN_IF_LABEL, loc);
      }
    /
    kwd:('ifd' / 'ifp') !_Word { return { type: 'UnclassifiedExpression', raw: kwd, loc: location(),}; }
  ) _0 (_Eol / LineComment)? consequent:(
    stmt:(_0 @NonemptyStmt)? {
      return diagnoseNullishStatement(stmt, CONSEQUENT_IN_IF_LABEL);
    }
  ) alternate:(
    _0 'else' !_Word _0 (_Eol / LineComment)? @(
      stmt:(_0 @NonemptyStmt)? {
        return diagnoseNullishStatement(stmt, ALTERNATIVE_IN_IF_LABEL);
      }
    )
  )? {
    return { type: 'IfStatement', test, consequent, alternate, loc: location(), };
  }

/**
 * <BNF> while ( experssion ) statement
 */
WhileStmt 'while statement' =
  'while' _0 test:(
    '(' _0 expr:ExprForceSingle? _0 closer:')'? _0 (_Eol / LineComment)? {
      const loc = location();
      diagnoseIfNotClosed(closer, TEST_IN_WHILE_LABEL, loc);
      return diagnoseNullishExpression(expr, TEST_IN_WHILE_LABEL, loc);
    }
  ) body:(
    stmt:(_0 @NonemptyStmt)? {
      return diagnoseNullishStatement(stmt, BODY_IN_WHILE_LABEL);
    }
  ) {
    return { type: 'WhileStatement', test, body, loc: location(), };
  }
  
/**
 * <BNF> for ( expr_opt; expr_opt; expr_opt ) statement
 * <BNF> for (identifier in assoc-array ) statement
 * While the first and third expression in a regular for-loop can be comma-separated expressions,
 * the second expression must be a single expression.
 */
ForStmt 'for statement' =
  'for' _0 stmt:(
    '(' _0 stmt2:(
      init:ExprSingleList? _0 ';' _0 test:ExprForceSingle? _0 ';' _0 update:ExprSingleList? {
        return { type: 'ForStatement', init: makeSequenceExpression(init), test, update: makeSequenceExpression(update), };
      }
      /
      left:NotMemberPattern _0 'in' !_Word _0 right:LValue {
        return { type: 'ForInStatement', left, right };
      }
    ) _0 closer:')'? {
      const loc = location();
      diagnoseIfNotClosed(closer, TEST_IN_FOR_LABEL, loc);
      return stmt2;
    }
  ) _0 (_Eol / LineComment)? body:(
    stmt2:(_0 @NonemptyStmt)? {
      return diagnoseNullishStatement(stmt2, BODY_IN_FOR_LABEL);
    }
  ) {
    stmt.body = body;
    stmt.loc = location();
    return stmt;
  }

/**
 * <BNF> break [;]
 */
BreakStmt 'break statement' =
  'break' _0 Eos {
    return { type: 'BreakStatement', loc: location() };
  }

/**
 * <BNF> continue [;]
 */
ContinueStmt 'continue statement' =
  'continue' _0 Eos {
    return { type: 'ContinueStatement', loc: location() };
  }

/**
 * <BNF> return [expression] [;]
 * <NOTICE> not documented in Grammar Rules.
 */
ReturnStmt 'return statement' =
  'return' !_Word _0 argument:ExprSingle? _0 Eos {
    return { type: 'ReturnStatement', argument, loc: location() };
  }

/**
 * <BNF> exit [;]
 * <NOTICE> no correspondence item in Parser AST.
 */
ExitStmt 'exit statement' =
  'exit' _0 Eos {
    return { type: 'ExitStatement', loc: location() };
  }

/**
 * <NOTICE> no correspondence item in Parser AST.
 */
QuitStmt 'quit statement' =
  'quit' _0 Eos {
    const loc = location();
    pushDiagnostic(l10n.t('"quit" command cannot be included in a macro.'), loc, DiagnosticSeverity.Warning);
    return { type: 'QuitStatement', loc };
  }


 // ## DECLARATIONS

/**
 * <BNF> def identifier string-constant [;]
 * <BNF> rdef identifier expression [;]
 *
 * body in FunctionDeclaration in the Parser AST must be BlockStatement or Expression.
 * params in FunctionDeclaration in the Parser AST must not be null.
 */
MacroDef 'macro declaration' =
  kwd:('def' / 'rdef') _1 id:LooseIdValidated _0 params:(
    '(' _0 params:LooseIdValidated|.., _LooseDelimComma| exComma:_DelimCommaWLoc? _0 closer:')'? _0 {
      const loc = location();
      if (exComma) {
        pushDiagnostic(l10n.t('Trailing comma not allowed.'), exComma.loc);
      }
      diagnoseIfNotClosed(closer, FUNC_PARAM_LIST_LABEL, loc);
      return params;
    }
  )?
  _0 body:(
    opener:_QuotMark &{ return testIfQuoteStarts(opener); }
    _0 Eos? stmts:Stmt*
    closer:_QuotMark? &{ return testIfQuoteEnds(opener, closer); }
    _0 Eos {
      const loc = location();
      diagnoseIfNotClosed(closer, MACRO_DEF_LABEL, loc, opener.length);
      if (params && (stmts.length !== 1 || stmts[0].type !== 'BlockStatement')) {
        pushDiagnostic(l10n.t('Function body must be enclosed in curly brackets.'), location());
      }
      return stmts;
    }
    /
    &{ return kwd === 'rdef'; } expression:ExprMulti {
      return [{ type: 'ExpressionStatement', expression, loc: location(), }];
    }
    /
    stmt:Stmt? _0 Eos {
      pushDiagnostic(l10n.t('Expected macro definition body, which must be embraced with quotes.'), location());
      return stmt ? [stmt] : [];
    }
  ) {
    return { type: 'FunctionDeclaration', id, params, body, rdef: kwd === 'rdef', loc: location() };
  }

/**
 * <BNF> undef identifier-list [;]
 */
UndefStmt 'undef statement' =
  &'undef' callee:StrictId _1 args:LooseIdValidated|.., _LooseDelim| exComma:_DelimCommaWLoc? _0 Eos {
    if (exComma) {
      pushDiagnostic(l10n.t('Trailing comma not allowed.'), exComma.loc);
    }
    if (args.length === 0) {
      pushDiagnostic(l10n.t('Expected at least one identifier.'), location());
    }
    return { type: 'MacroStatement', callee, arguments: args, builtin: true, loc: location() };
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
 *
 * As of spec 6.10.02, initialization of data arrays is supported.
 * https://certif.com/spec_help/chg6_10.html
 *
 * Though not described in the BNF above, it seems multiple variables can be
 * declared in a single data-array declaration, like
 * `array a[5][5], b[5][5], c[5][5]`.
 */

DArrayDef 'data-array declaration' =
  kind:(@('local' / 'global' / 'shared') _1)? datatype:(@_DArrayDType _1)? 'array' _1 declarations:DArrayDeclarators _0 Eos {
    return { type: 'VariableDeclaration', dataarray: true, kind, declarations, datatype, loc: location() };
  }
  / kind:'extern' _1 'shared' _1 'array' _1 declarations:ExternDArrayDeclarators _0 Eos {
    return { type: 'VariableDeclaration', dataarray: true, kind, declarations, loc: location() };
  }

_DArrayDType =
  'string' / 'float' / 'double'
  / $('u'? ('byte' / 'short' / 'long' '64'?))

DArrayDeclarators =
  declarators:(
    memberExpr:MemberExpr init:(
      space:_0 op:'=' !'=' _0 term:ExprMulti? {
        return diagnoseNoOperatorFollower(term, op, space.length);
      }
    )? {
      const id = memberExpr.object;
      if (memberExpr.properties.length === 0) {
        pushDiagnostic(l10n.t('Array size must be specified.'), memberExpr.loc);
      }
      const sizes = memberExpr.properties.map(property => {
        if (property.type !== 'MemberAccessProperty') {
          console.log('Unexpected property type:', property.type);
        } else if (property.values.length === 0) {
          pushDiagnostic(l10n.t('Array size must be specified.'), property.loc);
        } else if (property.values.length > 1) {
          pushDiagnostic(l10n.t('Multiple value is not allowed.'), property.loc);
        } else if (property.values.some(value => value.type === 'SliceElement')) {
          pushDiagnostic(l10n.t('Slice is not allowed.'), property.loc);
        }
        return property;
      });
      return { type: 'VariableDeclarator', id, sizes, init, loc: location(), };
    }
  )|.., _LooseDelimComma| exComma:_DelimCommaWLoc? {
    if (declarators.length === 0) {
      pushDiagnostic(l10n.t('Declaration list cannot be empty.'), location());
    // } else if (declarators.length > 1) {
    //   pushDiagnostic(l10n.t('Only one declarator is allowed.'), location());
    }
    if (exComma) {
      pushDiagnostic(l10n.t('Trailing comma not allowed.'), exComma.loc);
    }
    return declarators;
  }

ExternDArrayDeclarators =
  declarators:(opt:(@$_Word+ _0 ':' @(_0 @$[0-9]+ _0 ':' _0)?)? id:NotMemberPattern {
    const declarator = { type: 'VariableDeclarator', id, extern: { raw: text(), }, loc: location(), };
    if (opt) {
      declarator.extern.spec = opt[0];
      if (opt[1]) {
        declarator.extern.pid = opt[1];
      }
    }
    return declarator;
  })|.., _LooseDelimComma| exComma:_DelimCommaWLoc? {
    if (declarators.length === 0) {
      pushDiagnostic(l10n.t('Declaration list cannot be empty.'), location());
    } else if (declarators.length > 1) {
      pushDiagnostic(l10n.t('Only one declarator is allowed.'), location());
    }
    if (exComma) {
      pushDiagnostic(l10n.t('Trailing comma not allowed.'), exComma.loc);
    }
    return declarators;
  }

/**
 * <BNF> local identifier-list [;]
 * <BNF> global identifier-list [;]
 * <BNF> unglobal identifier-list [;]
 *
 * It seems a delimiter can be either a comma or a whitespace.
 */
VariableDef 'variable declaration' =
  // TODO: move `unglobal` to macro statement.
  kind:('local' / 'global' / 'unglobal') _1 declarations:VariableDeclarators _0 Eos {
    if (declarations.length === 0) {
      pushDiagnostic(l10n.t('Declaration list cannot be empty.'), location());
    } else if (declarations.length > 1 && declarations.some(d => !!d.init)) {
      pushDiagnostic(l10n.t('Only one declarator is allowed when value is assigned.'), location());
    }
    return { type: 'VariableDeclaration', dataarray: false, declarations, kind, loc: location() };
  }


/**
 * <BNF> constant identifier expression [;]
 * <BNF> constant identifier = expression [;]
 */
ConstantDef 'constant declaration' =
  'constant' _1 declarations:(
    id:LValue _1 (!'=') init:ExprMulti? {
      if (!init) {
        pushDiagnostic(l10n.t('Expected initial value for constant.'), location());
      }
      const declarator = { type: 'VariableDeclarator', id, init, loc: location() };
      return [declarator];
    }
    /
    VariableDeclarators
  ) _0 Eos {
    if (declarations.length === 0) {
      pushDiagnostic(l10n.t('Expected following identifier and initial value.'), location());
    } else if (declarations.length > 1) {
      pushDiagnostic(l10n.t('Only single constant can be declared per statement.'), location());
    }
    return { type: 'VariableDeclaration', dataarray: false, declarations, kind: 'const', loc: location() };
  }

VariableDeclarators =
  declarators:(
    memberExpr:MemberExpr init:(
      space:_0 op:'=' !'=' _0 term:ExprMulti? {
        return diagnoseNoOperatorFollower(term, op, space.length);
      }
    )? {
      const id = memberExpr.object;
      let assocarray;
      if (memberExpr.properties.length === 0) {
        assocarray = false;
      } else {
        assocarray = true;
        if (memberExpr.properties.length > 1) {
          pushDiagnostic(l10n.t('Too many brackets.'), memberExpr.loc);
        }
        memberExpr.properties.forEach(property => {
          if (property.type !== 'MemberAccessProperty') {
            console.log('Unexpected property type:', property.type);
          } else if (property.values.length > 0) {
            pushDiagnostic(l10n.t('Array index or size cannot be specified here.'), property.loc);
          }
        });
      }
      return { type: 'VariableDeclarator', id, init, assocarray, loc: location() };
    }
  )|.., _LooseDelim| exComma:_DelimCommaWLoc? {
    if (exComma) {
      pushDiagnostic(l10n.t('Trailing comma not allowed.'), exComma.loc);
    }
    return declarators;
  }

/*
 * OTHER STATEMENTS
 */

/**
 * <BNF> delete assoc-elem-list [;]
 * <BNF> delete assoc-array [;]
 *
 * It seems a delimiter can be either a comma or a whitespace.
 * The BNF in the Grammar Rules does not seems described correctly.
 * Deleting associative array without specifying indexes, as shown below, 
 * causes a syntax error.
 * > global arr
 * > arr = [1: "foo"];
 * > delete arr
 */
DeleteStmt 'delete statement' =
  &'delete' callee:StrictId _1 args:LValue|.., _LooseDelim| exComma:_DelimCommaWLoc? _0 Eos {
    if (exComma) {
      pushDiagnostic(l10n.t('Trailing comma not allowed.'), exComma.loc);
    }
    if (args.length === 0) {
      pushDiagnostic(l10n.t('Expected {0}.', ASSOC_ARRAY_LABEL), callee.loc ?? location());
    }
    // TODO: check empty array acess. `delete arr[]`.
    return { type: 'MacroStatement', callee, arguments: args, builtin: true, loc: location(), };
  }

/**
 * <BNF> lscmd pattern-list-opt [;]
 * <BNF> syms pattern-list-opt [;]
 * <BNF> lsdef pattern-list-opt [;]
 * <BNF> prdef pattern-list-opt [;]
 */
MatchStmt =
  &('syms' / 'lscmd' / 'lsdef' / 'prdef') callee:StrictId args:(
    flags:(_1 @(
      flag:[-+] value:$(!(__ / [-+] / Eos) .)+ {
        return { type: 'Literal', value, raw: text(), flag, loc: location() };
      }
    )|1.., _0|)? remains:(
      _1 @(
        value:$(!(__ / Eos) .)+ {
          // if (!SYMBOL_MATCH_REGEXP.test(value)) {
          //   pushDiagnostic(l10n.t('Expected a symbol name.'), location());
          // }
          return { type: 'Literal', value, raw: text(), loc: location() };
        }
      )|1.., _1|
    )? {
      const flags2 = flags ?? [];
      const remains2 = remains ?? [];
      return [...flags2, ...remains2];
    }
  ) _0 Eos {
    args.forEach(arg => {
      if (arg.type === 'Literal') {
        if (arg.flag) {
          if (callee.name === 'syms') {
            if (arg.flag === '-') {
              const matches = arg.value.matchAll(/[^vBGLADNSICWM]+/g);
              for (const match of matches) {
                pushDiagnostic(
                  l10n.t('Unknown optional parameter.'),
                  getRangeFromLocation(arg.loc.source, arg.loc.start, match[0].length, match.index + 1),
                  DiagnosticSeverity.Warning,
                );
              }
            } else if (arg.flag === '+') {
              const matches = arg.value.matchAll(/[^BGLADNSICWM]+/g);
              for (const match of matches) {
                pushDiagnostic(
                  l10n.t('Unknown optional parameter.'),
                  getRangeFromLocation(arg.loc.source, arg.loc.start, match[0].length, match.index + 1),
                  DiagnosticSeverity.Warning,
                );
              }
            }
          } else {
            pushDiagnostic(l10n.t('"{0}" does not support flags.', callee.name), arg.loc, DiagnosticSeverity.Warning);
          }
        // } else {
        //   if (!SYMBOL_MATCH_REGEXP.test(arg.value)) {
        //     pushDiagnostic(l10n.t('Expected a symbol name.'), arg.loc);
        //   }
        }
      }
    });
    return { type: 'MacroStatement', callee, arguments: args, builtin: true, loc: location() };
  }

/**
 * <BNF> memstat [;]
 * <BNF> savstate [;]
 * <BNF> reconfig [;]
 * <BNF> getcounts [;]
 * <BNF> move_all [;]
 * <BNF> move_cnt [;]
 * <BNF> sync [;]
 *
 * history [n|-n]
 * print a, b, ...
 *
 * `print` and `eprint` behave differently than orginally macros.
 * This built-in commands accept comma-separated parameters and allow whitepaces in a parameter
 * (IOW, they do not recognize whitespaces as a delimiter).
 * Instead whitespaces are treated as a string concatenation operator. E.g., 
 * `print 1 2 + 2 3, 4, 5*5 # output 143 4 25`.
 * 
 * A traditional macro (not built-in command) treats one or more continous whitespaces not enclosed 
 * by string quotations as a delimiter of the arguments.
 * The begining end end of string quotation are also treated as a delimiter (in this case 
 * a whitespace is unnecessary). E.g., 
 * `mymacro"a""b c"d e # -> "$1" == "a"; "$2" == "b c"; "$3" == "d"; "$4" == "e"
 */
MacroStmt =
  &('print' / 'eprint') callee:StrictId _1 args:ExprMultiList _0 Eos {
    diagnoseNullishElementInArray(args, ARGUMENT_LABEL);
    return { type: 'MacroStatement', callee, arguments: args, builtin: true, loc: location() };
  }
  /
  &('memstat' / 'savstate' / 'reconfig' / 'getcounts' / 'move_all' / 'move_cnt' / 'sync' / 'history') callee:StrictId
  args:((_1 / &'"') @(StringLiteral / ExprMA)|.., _0|)?
  _0 Eos {
    return { type: 'MacroStatement', callee, arguments: args ?? [], builtin: true, loc: location() };
  }
  /
  callee:StrictId args:((_1 / &'"') @(StringLiteral / ExprMA)|.., _0|)? _0 Eos {
    return { type: 'MacroStatement', callee, arguments:args ?? [], loc: location() };
  }

/**
 * <BNF> expression [;]
 */
ExprStmt 'expression statement' =
  exprs:ExprMultiList _0 Eos {
    const expression = makeSequenceExpression(exprs);
    return { type: 'ExpressionStatement', expression, loc: location() };
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
 * Expression that does not include concatenation.
 *
 * FunctionCall and UpdateExpr must precede lvalue.
 * UpdateExpr must precede UnaryExpr.
 */
ExprSingle 'expression' =
  ExprRule15

/** 
 * Expression without whitespaces. This can be used as a macro argument.
 */
ExprMA =
  ExprRule14MA

/**
 * The core expression rules with operators haiving the 1st and 2nd priorities.
 */
ExprRule2 =
  StringLiteral / NumericLiteral / ArrayLiteral / ExprBlock / FunctionCall
  / UpdateExpr / UnaryExpr / LValue / InvalidExpr

ExprRule2MA =
  NumericLiteral / ArrayLiteralMA / ExprBlockMA / FunctionCallMA
  / UpdateExprMA / UnaryExprMA / LValueMA / InvalidExprMA

/**
 * <BNF> identifier
 *
 * Identifier without member accessors such as `[1]`.
 * 
 * __Macro Parameters__
 *
 * The symbols $1, $2, ... within ordinary macros are replaced by 
 * the arguments with which the macro is invoked.
 * Therefore, it is difficult to gramatically define these symbols.
 * Expediently, this PEG grammar treats them as identifiers.
 *
 * __Indirect Pattern__
 * 
 * > When the @ indirection operator precedes something in parentheses, 
 * > previously, that something could only be a variable or associative array
 * > element. With this release, the item in parenthesis can be any expression 
 * > that evaluates to a variable name on which the @ can operate.
 * https://certif.com/spec_help/chg6_12.html
 */
NotMemberPattern =
  IdValidated
  /
  op:'@' _0 expr:(IdValidated / ExprBlock)? {
    const loc = location();
    const expression = diagnoseNoOperatorFollower(expr, op, 0, loc);
    return { type: 'IndirectPattern', expression, loc };
  }

NotMemberPatternMA =
  IdValidated
  /
  '@' expression:(IdValidated / ExprBlockMA) {
    const loc = location();
    return { type: 'IndirectPattern', expression, loc };
  }


/** Identifier. */
StrictId =
  name:$([a-zA-Z_][a-zA-Z0-9_]*) {
    return { type: 'Identifier', name, loc: location() };
  }

/** Identifier with validation of not using reserved keywords. */
IdValidated =
  items:(
    ![0-9] @(
      char:$[a-zA-Z0-9_]+ { return [char, undefined]; }
      /
      char:$('\\'? '$' ([*@#$] / [0-9]+)) { return [char, { type: 'MacroParameter', name: char, loc: location() }]; }
    )+ 
  ) {
    let name = '';
    /** * @type {Array<MacroParameter>} */
    const params = [];
    items.forEach(item => {
      name += item[0];
      if (item[1] !== undefined) {
        params.push(item[1]);
      }
    });

    /** @type {Identifier} */
    const node = { type: 'Identifier', name, loc: location() };
    if (RESERVED_KEYWORD_REGEXP.test(name)) {
      pushDiagnostic(l10n.t('"{0}" is a reserved keyword.', name), node.loc);
    // } else if (name === 'const') {
    //   pushDiagnostic(l10n.t('Using {0} for "constant"?', name), node.loc, DiagnosticSeverity.Information);
    // } else if (name === 'elseif' || name === 'elif') {
    //   pushDiagnostic(l10n.t('Using {0} for "else if"?', name), node.loc, DiagnosticSeverity.Information);
    }
    if (params.length > 0) {
      node.params = params;
    }
    return node;
  }

LooseIdValidated =
  id:IdValidated
  /
  name:$[a-zA-Z0-9_.+\-*/%!?^~\\]+
  // name:$[^#,'"(){}[\];: \t\r\n\\]+
  {
    const loc = location();
    pushDiagnostic(l10n.t('Invalid identifier.'), loc);
    return { type: 'Identifier', name, loc };
  }

// MacroSymbol =
//   value:$('\\'? '$' ([*@#$] / [0-9]+)) {
//     return { type: 'MacroSymbolPattern', value, loc: location(), };
//   }

/*
 * <BNF> identifier
 * <BNF> identifier[expression]
 * <BNF> identifier[expression][expression]
 *
 * e.g., _foo12, bar[myfunc(a)], bar[], bar[:], bar[:4], bar[2:], bar[1, 2, 3:5], ...
 */

LValue 'left value' =
  expr:MemberExpr {
    return expr.properties.length === 0 ? expr.object : expr;
  }

LValueMA =
  expr:MemberExprMA {
    return expr.properties.length === 0 ? expr.object : expr;
  }

MemberExpr =
  object:NotMemberPattern properties:(_0 @MemberAccessProp)* {
    if (properties.length > 2) {
      pushDiagnostic(l10n.t('Array dimension must be 2 or less.'), location());
    }
    return { type: 'MemberExpression', object, properties, loc: location() };
  }

MemberExprMA =
  object:NotMemberPatternMA properties:(@MemberAccessPropMA)* {
    if (properties.length > 2) {
      pushDiagnostic(l10n.t('Array dimension must be 2 or less.'), location());
    }
    return { type: 'MemberExpression', object, properties, loc: location() };
  }


MemberAccessProp =
  '[' _0 values:(
    SliceElement / ExprMulti
  )|.., _DelimComma| exComma:_DelimCommaWLoc? _0 closer:']'? {
    const loc = location();
    if (exComma) {
      pushDiagnostic(l10n.t('Trailing comma not allowed.'), exComma.loc);
    }
    diagnoseIfNotClosed(closer, BRACKET_LABEL, loc);
    return { type: 'MemberAccessProperty', values, loc };
  }

MemberAccessPropMA =
  '[' values:(
    SliceElementMA / ExprMA
  )|.., ','| exComma:(',' { return { loc: location() }; })? closer:']'? {
    const loc = location();
    if (exComma) {
      pushDiagnostic(l10n.t('Trailing comma not allowed.'), exComma.loc);
    }
    diagnoseIfNotClosed(closer, BRACKET_LABEL, loc);
    return { type: 'MemberAccessProperty', values, loc };
  }

SliceElement =
  start:ExprMulti? _0 ':' _0 end:ExprMulti? {
    return { type: 'SliceElement', start: start ?? getNullLiteral(), end: end ?? getNullLiteral(), loc: location() };
  }

SliceElementMA =
  start:ExprMA? ':' end:ExprMA? {
    return { type: 'SliceElement', start: start ?? getNullLiteral(), end: end ?? getNullLiteral(), loc: location() };
  }


InvalidExpr =
  '{' Eos? _0 stmts:ExprMultiList? _0 '}'? Eos? {
    pushDiagnostic(l10n.t('Braces are to bundle statements. Use parentheses "()" for expressions.'), location());
    return { type: 'UnclassifiedExpression', raw: text(), loc: location() };
  }
  /
  value:$[^#,'"(){}[\];: \t\r\n\\]+ {
    pushDiagnostic(l10n.t('Invalid expression. It should be quoted if it is a string.'), location(), DiagnosticSeverity.Warning);
    return { type: 'Literal', value: text(), raw: text(), loc: location() };
  }

InvalidExprMA =
  '{' stmts:ExprMultiList? '}'? {
    pushDiagnostic(l10n.t('Braces are to bundle statements. Use parentheses "()" for expressions.'), location());
    return { type: 'UnclassifiedExpression', raw: text(), loc: location() };
  }
  // /
  // value:$[^#,'"(){}[\];:\t\r\n\\]+ {
  //   pushDiagnostic(l10n.t('Invalid expression. It should be quoted if it is a string.'), location(), DiagnosticSeverity.Warning);
  //   return { type: 'Literal', value: text(), raw: text(), loc: location() };
  // }

// +-*/%^&|=

/**
 * <BNF> string-constant
 *
 * e.g., "foo,\"bar\"\n123", \'foo\'
 */
StringLiteral 'string literal' =
  opener:_QuotMark &{ return testIfQuoteStarts(opener); }
  chars:(
    '\\' @(
      p:$([0-7][0-7]?[0-7]?) { return String.fromCharCode(parseInt(p, 8)); }
      /
      p:'[' cmd:$_Word+ ']' {
        if (!TTY_COMMAND_REGEXP.test(cmd)) {
          pushDiagnostic(l10n.t('"{0}" is not a TTY command.', cmd), location(), DiagnosticSeverity.Warning);
        }
        return text();
      }
      /
      // p:[abfnrt'"\\$\n] &{ return testIfEscapedCharIsAvailable(p); }
      p:. &{ return testIfEscapedCharIsAvailable(p); } {
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
          default:
            const loc = location();
            loc.start.offset -= 1;
            loc.start.column -= 1;
            pushDiagnostic(l10n.t('Unknown escape sequence.'), loc, DiagnosticSeverity.Warning);
            return p;
        }
      }
    )
    /
    r:[^\\] &{ return testIfUnescapedCharIsAvailable(r); }
      {
        if (!testIfEscapedCharIsAvailable(r)) {
          pushDiagnostic(l10n.t('Quotation symbol not allowed.'), location());
        }
        return r;
      }
  )*
  closer:_QuotMark? &{ return testIfQuoteEnds(opener, closer); } {
    const loc = location();
    diagnoseIfNotClosed(closer, STRING_LITERAL_LABEL, loc, opener.length);
    return { type: 'Literal', value: chars.join(''), raw: text(), loc: location() };
  }

/** 
 * <BNF> numeric-constant
 *
 * e.g., 0.1, 1e-3, 19, 017, 0x1f
 */
NumericLiteral 'numeric literal' =
  // floating-point
  (([0-9]+ (Exponent / '.' [0-9]* Exponent?)) / '.' [0-9]+ Exponent?) {
    return { type: 'Literal', value: parseFloat(text()), raw: text(), loc: location() };
  }
  /
  // hexadecimal integer
  '0' [xX] body:$[0-9a-fA-F]+ {
    return { type: 'Literal', value: parseInt(body, 16), raw: text(), loc: location() };
  }
  /
  // octal integer
  '0' body:$[0-7]+ {
    return { type: 'Literal', value: parseInt(body, 8), raw: text(), loc: location() };
  }
  /
  // decimal integer
  [0-9]+ {
    return { type: 'Literal', value: parseInt(text(), 10), raw: text(), loc: location() };
  }

// exponential part in floating-point digit, e.g., E+3 in 1.2E+3)
Exponent =
  [eE] [+-]? [0-9]+

/**
 * Array literals used in assignment operation for data array and associative array.
 * its BNF is undocumented in the Grammar Rules.
 * 
 * For data array, they can be like `[ 1, 2, 3 ]` or `[ "this is a test" ]`.
 * For associative array, they can be like: `[var0, 1+2, "test"]`, `["foo": 0x12, "bar": var1]`, `[ 1: 2: "item", 2: 3: "item2" ]`.
 */
ArrayLiteral 'array literal' =
  '[' _0 properties:(
      expr:ArrayItem !_DelimComma { return [expr];}
      /
      @(expr:ArrayItem? { return expr ?? getNullLiteral(); })|2.., _DelimComma|
  )? _0 closer:']'? {
    const loc = location();
    if (properties) {
      diagnoseNullishElementInArray(properties, ARRAY_ELEMENT_LABEL);
      for (const property of properties) {
        if (property.type === 'Property') {
          if (property.value.type === 'Literal' && property.value.value === null) {
            pushDiagnostic(l10n.t('Expected {0}.', ARRAY_ELEMENT_LABEL), property.value.loc ?? location());
          }
          diagnoseNullishElementInArray(property.keys, ARRAY_INDEX_LABEL);
        }
      }
    } else {
      pushDiagnostic(l10n.t('Expected {0}.', ARRAY_ELEMENT_LABEL), loc);
      properties = [];
    }
    diagnoseIfNotClosed(closer, BRACKET_LABEL, loc);
    return { type: 'ObjectExpression', properties, loc };
  }

ArrayLiteralMA 'array literal' =
  '[' properties:(
      expr:ArrayItemMA !',' { return [expr];}
      /
      @(expr:ArrayItemMA? { return expr ?? getNullLiteral(); })|2.., ','|
  )? closer:']'? {
    const loc = location();
    if (properties) {
      diagnoseNullishElementInArray(properties, ARRAY_ELEMENT_LABEL);
      for (const property of properties) {
        if (property.type === 'Property') {
          if (property.value.type === 'Literal' && property.value.value === null) {
            pushDiagnostic(l10n.t('Expected {0}.', ARRAY_ELEMENT_LABEL), property.value.loc ?? location());
          }
          diagnoseNullishElementInArray(property.keys, ARRAY_INDEX_LABEL);
        }
      }
    } else {
      pushDiagnostic(l10n.t('Expected {0}.', ARRAY_ELEMENT_LABEL), loc);
      properties = [];
    }
    diagnoseIfNotClosed(closer, BRACKET_LABEL, loc);
    return { type: 'ObjectExpression', properties, loc: location() };
  }

/**
 * An item in array-literal, either a colon-separated pair of expressions or a single expression.
 *  e.g., 
 */
ArrayItem =
  keys:(expr:ExprMulti? _0 ':' _0 { return expr ?? getNullLiteral(); })|1..2| value:(expr:ExprMulti? { return expr ?? getNullLiteral(); }) {
    return { type: 'Property', keys, value, loc: location() };
  }
  /
  ExprMulti

ArrayItemMA =
  keys:(expr:ExprMA? ':' { return expr ?? getNullLiteral(); })|1..2| value:(expr:ExprMA? { return expr ?? getNullLiteral(); }) {
    return { type: 'Property', keys, value, loc: location() };
  }
  /
  ExprMA

/**
 * <BNF> ( expression )
 * Expression in the Parser AST must not be null.
 */
ExprBlock 'parentheses that enclose expression' =
  '(' _0 expr:ExprMulti? _0 closer:')'? {
    const loc = location();
    diagnoseIfNotClosed(closer, PAREN_LABEL, loc);
    return diagnoseNullishExpression(expr, EXPR_IN_PAREN_LABEL, loc);
  }

ExprBlockMA 'parentheses that enclose expression' =
  '(' expr:ExprMA? closer:')'? {
    const loc = location();
    diagnoseIfNotClosed(closer, PAREN_LABEL, loc);
    return diagnoseNullishExpression(expr, EXPR_IN_PAREN_LABEL, loc);
  }

/**
 * <BNF> function(expression-list)
 *
 * Respective arguments must be separated with a comma.
 * It seems spec does not allow string concatenation of arguments.
 */
FunctionCall 'function call' =
  expr:IdValidated _0 args:(
    '(' _0 args:ExprSingleList? _0 closer:')'? {
      const loc = location();
      if (args) {
        diagnoseNullishElementInArray(args, FUNC_ARGUMENT_LABEL);
      }
      diagnoseIfNotClosed(closer, FUNC_PARAM_LIST_LABEL, loc);
      return args;
    }
  ) {
    return { type: 'CallExpression', callee: expr, arguments: args ?? [], loc: location() };
  }

FunctionCallMA =
  expr:IdValidated args:(
    '(' args:ExprListMA? closer:')'? {
      const loc = location();
      if (args) {
        diagnoseNullishElementInArray(args, FUNC_ARGUMENT_LABEL);
      }
      diagnoseIfNotClosed(closer, FUNC_PARAM_LIST_LABEL, loc);
      return args;
    }
  ) {
    return { type: 'CallExpression', callee: expr, arguments: args ?? [], loc: location() };
  }


/**
 * <BNF> + expression
 * <BNF> - expression
 * <BNF> ! expression
 * <BNF> ~ expression
 */
_UnaryOp = '+' / '-' / '!' / '~'

UnaryExpr 'unary expression' =
  op:_UnaryOp _0 arg:ExprSingle? {
    const loc = location();
    const arg2 = diagnoseNoOperatorFollower(arg, op, 0, loc);
    return { type: 'UnaryExpression', operator: op, argument: arg2 , prefix: true, loc };
  }

UnaryExprMA =
  op:_UnaryOp arg:ExprMA {
    const loc = location();
    return { type: 'UnaryExpression', operator: op, argument: arg, prefix: true, loc };
  }

/**
 * <BNF> ++ lvalue
 * <BNF> −− lvalue
 * <BNF> lvalue ++
 * <BNF> lvalue −−
 */
_UpdateOp = '++' / '--'

UpdateExpr 'update expression' =
  op:_UpdateOp _0 arg:LValue? {
    const loc = location();
    const arg2 = diagnoseNoOperatorFollower(arg, op, 0, loc, l10n.t('variable'));
    return { type: 'UpdateExpression', operator: op, argument: arg2, prefix: true, loc };
  }
  / arg:LValue _0 op:_UpdateOp {
    return { type: 'UpdateExpression', operator: op, argument: arg, prefix: false, loc: location() };
  }

UpdateExprMA =
  op:_UpdateOp arg:LValueMA {
    const loc = location();
    return { type: 'UpdateExpression', operator: op, argument: arg, prefix: true, loc };
  }
  / arg:LValueMA op:_UpdateOp {
    return { type: 'UpdateExpression', operator: op , argument: arg, prefix: false, loc: location() };
  }

/**
 * <BNF> expression binop expression
 * 3rd priority: * / %
 */
_OpRule3 = @('*' / '/' / '%') !'='

ExprRule3 =
  head:ExprRule2 tails:(
    space:_0 op:_OpRule3 _0 term:ExprRule2? {
      return [op, diagnoseNoOperatorFollower(term, op, space.length)];
    }
  )* {
    return getBinaryExpression(head, tails);
  }

ExprRule3MA =
  head:ExprRule2MA tails:(
    @op:_OpRule3 @term:ExprRule2MA // { return [op, term]; }
  )* {
    return getBinaryExpression(head, tails);
  }

/**
 * <BNF> expression binop expression
 * 4th priority: + -
 */
_OpRule4 = @('+' / '-') !'='

ExprRule4 =
  head:ExprRule3 tails:(
    space:_0 op:_OpRule4 _0 term:ExprRule3? {
      return [op, diagnoseNoOperatorFollower(term, op, space.length)];
    }
  )* {
    return getBinaryExpression(head, tails);
  }

ExprRule4MA =
  head:ExprRule3MA tails:(
    @op:_OpRule4 @term:ExprRule3MA // { return [op, term]; }
  )* {
    return getBinaryExpression(head, tails);
  }

/**
 * <BNF> expression binop expression
 * 5th priority: << >>
 */
_OpRule5 = @('<<' / '>>') !'='

ExprRule5 =
  head:ExprRule4 tails:(
    space:_0 op:_OpRule5 _0 term:ExprRule4? {
      return [op, diagnoseNoOperatorFollower(term, op, space.length)];
    }
  )* {
    return getBinaryExpression(head, tails);
  }

ExprRule5MA =
  head:ExprRule4MA tails:(
    @op:_OpRule5 @term:ExprRule4MA // { return [op, term]; }
  )* {
    return getBinaryExpression(head, tails);
  }

/**
 * <BNF> expression binop expression
 * 6th priority: < <= > >=
 */
_OpRule6 = $('<' !'<' '='?) / $('>' !'>' '='?)

ExprRule6 =
  head:ExprRule5 tails:(
    space:_0 op:_OpRule6 _0 term:ExprRule5? {
      return [op, diagnoseNoOperatorFollower(term, op, space.length)];
    }
  )* {
    return getBinaryExpression(head, tails);
  }

ExprRule6MA =
  head:ExprRule5MA tails:(
    @op:_OpRule6 @term:ExprRule5MA // { return [op, term]; }
  )* {
    return getBinaryExpression(head, tails);
  }

/**
 * <BNF> expression binop expression
 * 7th priority: == !=
 */
_OpRule7 = '==' / '!='

ExprRule7 =
  head:ExprRule6 tails:(
    space:_0 op:_OpRule7 _0 term:ExprRule6? {
      return [op, diagnoseNoOperatorFollower(term, op, space.length)];
    }
  )* {
    return getBinaryExpression(head, tails);
  }

ExprRule7MA =
  head:ExprRule6MA tails:(
    @op:_OpRule7 @term:ExprRule6MA // { return [op, term]; }
  )* {
    return getBinaryExpression(head, tails);
  }

/**
 * <BNF> expression binop expression
 * 8th priority: &
 */
_OpRule8 = @'&' ![&=]

ExprRule8 =
  head:ExprRule7 tails:(
    space:_0 op:_OpRule8 _0 term:ExprRule7? {
      return [op, diagnoseNoOperatorFollower(term, op, space.length)];
    }
  )* {
    return getBinaryExpression(head, tails);
  }

ExprRule8MA =
  head:ExprRule7MA tails:(
    @op:_OpRule8 @term:ExprRule7MA // { return [op, term]; }
  )* {
    return getBinaryExpression(head, tails);
  }

/**
 * <BNF> expression binop expression
 * 9th prioirity: ^
 */
_OpRule9 = @'^' ![=]

ExprRule9 =
  head:ExprRule8 tails:(
    space:_0 op:_OpRule9 _0 term:ExprRule8? {
      return [op, diagnoseNoOperatorFollower(term, op, space.length)];
    }
  )* {
    return getBinaryExpression(head, tails);
  }

ExprRule9MA =
  head:ExprRule8MA tails:(
    @op:_OpRule9 @term:ExprRule8MA // { return [op, term]; }
  )* {
    return getBinaryExpression(head, tails);
  }

/**
 * <BNF> expression binop expression
 * 10th prioirity: |
 */
_OpRule10 = @'|' ![|=]

ExprRule10 =
  head:ExprRule9 tails:(
    space:_0 op:_OpRule10 _0 term:ExprRule9? {
      return [op, diagnoseNoOperatorFollower(term, op, space.length)];
    }
  )* {
    return getBinaryExpression(head, tails);
  }

ExprRule10MA =
  head:ExprRule9MA tails:(
    @op:_OpRule10 @term:ExprRule9MA // { return [op, term]; }
  )* {
    return getBinaryExpression(head, tails);
  }

/**
 * <BNF> expression binop expression
 * 11th prioirity: &&
 */
ExprRule11 =
  head:ExprRule10 tails:(
    space:_0 op:'&&' _0 term:ExprRule10? {
      return [op, diagnoseNoOperatorFollower(term, op, space.length)];
    }
  )* {
    return getLogicalExpression(head, tails);
  }

ExprRule11MA =
  head:ExprRule10MA tails:(
    @op:'&&' @term:ExprRule10MA // { return [op, term]; }
  )* {
    return getLogicalExpression(head, tails);
  }

/**
 * <BNF> expression binop expression
 * 12th prioirity: ||
 */
ExprRule12 =
  head:ExprRule11 tails:(
    space:_0 op:'||' _0 term:ExprRule11? {
      return [op, diagnoseNoOperatorFollower(term, op, space.length)];
    }
  )* {
    return getLogicalExpression(head, tails);
  }

ExprRule12MA =
  head:ExprRule11MA tails:(
    @op:'||' @term:ExprRule11MA // { return [op, term]; }
  )* {
    return getLogicalExpression(head, tails);
  }

// TODO: Not checked whether the parsed structure of conditional expression is correct
// when the expression includes multiple ternary operators. E.g., a ? b ? c : d : e
/*
 * <BNF> expression ? expression : expression
 * 13th priority: ? :
 */
ExprRule13 =
  head: ExprRule12 tails:(
    lSpace:_0 '?' _0 left1:ExprRule12? right1:(
      rSpace:_0 ':' _0 right0:ExprRule12? {
        return diagnoseNoOperatorFollower(right0, ':', rSpace.length);
      }
    )? {
      const left = diagnoseNoOperatorFollower(left1, '?', lSpace.length);
      const rightNotFoundLoc = getRangeFromLocation(left.loc.source, left.loc.end, 0, 0);
      const right = diagnoseNullishExpression(right1, l10n.t('":" operator and following expression'), rightNotFoundLoc);
      return [left, right];
    }
  )* {
    return tails.reduce((accumulator, currentValue) => {
      const [left, right]  = currentValue;
      return { type: 'ConditionalExpression', test: accumulator, left, right, loc: location(), };
    }, head);
  }

ExprRule13MA =
  head: ExprRule12MA tails:(
    '?' @left:ExprRule12MA @right:(':' @ExprRule12MA) // { return [left, right]; }
  )* {
    return tails.reduce((accumulator, currentValue) => {
      const [left, right]  = currentValue;
      return { type: 'ConditionalExpression', test: accumulator, left, right, loc: location() };
    }, head);
  }

/*
 * <BNF> lvalue asgnop expression
 * 14th priority: = += -= *= /= %= &= |= ^= <<= >>=
 */
_AssignOp =
  @'=' !'=' / '+=' / '-=' / '*=' / '/=' / '%='
  / '<<=' / '>>=' / '&=' / '^=' / '|='

ExprRule14 =
  head:ExprRule13 tail:(
    space:_0 op:_AssignOp _0 right:ExprMulti? {
      return [op, diagnoseNoOperatorFollower(right, op, space.length)];
    }
  )? {
    if (!tail) {
      return head;
    } else {
      if (head.type !== 'Identifier' && head.type !== 'IndirectPattern' && head.type !== 'MemberExpression') {
        pushDiagnostic(l10n.t('Left-side value must be assignable.'), location());
      }
      const [operator, right] = tail;
      return { type: 'AssignmentExpression', operator, left: head, right, loc: location(), };
    }
  }

ExprRule14MA =
  head:ExprRule13MA tail:(
    @op:_AssignOp @right:ExprMA // { return [operator, right]; }
  )? {
    if (!tail) {
      return head;
    } else {
      if (head.type !== 'Identifier' && head.type !== 'IndirectPattern' && head.type !== 'MemberExpression') {
        pushDiagnostic(l10n.t('Left-side value must be assignable.'), location());
      }
      const [operator, right] = tail;
      return { type: 'AssignmentExpression', operator, left: head, right, loc: location(), };
    }
  }

// TODO: Currently noOperationFollower error is not reached.
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
    space:_0 op:'in' !_Word _0 term:LValue? {
      return [op, diagnoseNoOperatorFollower(term, op, space.length)];
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
    space:_0 term:ExprSingle {
      if (!space || space.length === 0) {
        pushDiagnostic(l10n.t('Expressions should be separated with whitespace.'), location(), DiagnosticSeverity.Information);
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
      pushDiagnostic(l10n.t('Expression concatenation not allowed.'), location());
      return [' ', tail];
    }
  )* {
    return getBinaryExpression(head, tails);
  }

/*
 * BNF> expression, expression
 * Though these are recursively defined as 'expression' in the Grammar Rules, 
 * the spec interpreter sometimes treats them differently.
 * For example, a = 1, b = 2 can not be used for the test expression in if-clause
 * (though it is written "if (expression) statement" in the Grammar Rules).
 */

/**
 * Comma-separated expression list in which concatenation of the expressions is not allowed.
 * This just inserts a null literal when nothing is placed between commas.
 */
ExprSingleList 'comma-separated expression list' =
  expr:ExprForceSingle !_DelimComma { return [expr]; }
  /
  @(expr:ExprForceSingle? { return expr ?? getNullLiteral(); })|2.., _DelimComma|

ExprListMA 'comma-separated expression list' =
  expr:ExprForceSingle !',' { return [expr]; }
  /
  @(expr:ExprForceSingle? { return expr ?? getNullLiteral(); })|2.., ','|

/**
 * Comma-separated expression list in which concatenation of the expressions is allowed.
 * This just inserts a null literal when nothing is placed between commas.
 */
ExprMultiList 'comma-separated expression list' =
  expr:ExprMulti !_DelimComma { return [expr];}
  /
  @(expr:ExprMulti? { return expr ?? getNullLiteral(); })|2.., _DelimComma|
