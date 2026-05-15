// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Workflow DSL v2 parser: tokens -> AST.
 *
 * Grammar (informal):
 *
 *   WorkflowDecl = "workflow" IDENT "(" ParamList ")" ":" TypeExpr "{" Statement* "}"
 *   ParamList    = Param ("," Param)*
 *   Param        = IDENT ":" TypeExpr
 *   TypeExpr     = BaseType ("[]")?
 *   BaseType     = "string" | "number" | "integer" | "boolean" | "never" | "unknown"
 *                | "{" FieldList "}"
 *   Statement    = ConstStmt | DestructuringConst | IfStmt | SwitchStmt
 *                | ReturnStmt | BreakStmt | ThrowStmt | ExprStmt
 *   ConstStmt    = "const" IDENT (":" TypeExpr)? "=" Expr ";"?
 *   DestructConst= "const" "[" IDENT ("," IDENT)* "]" "=" Expr ";"?
 *   IfStmt       = "if" "(" Expr ")" "{" Statement* "}" ("else" "{" Statement* "}")?
 *   SwitchStmt   = "switch" "(" Expr ")" "{" (CaseArm | DefaultArm)* "}"
 *   CaseArm      = "case" Literal ":" Statement*
 *   DefaultArm   = "default" ":" Statement*
 *   ReturnStmt   = "return" Expr ";"?
 *   BreakStmt    = "break" ";"?
 *   ThrowStmt    = "throw" Expr ";"?
 *   Expr         = Ternary
 *   Ternary      = LogicalOr ("?" Expr ":" Expr)?
 *   LogicalOr    = LogicalAnd ("||" LogicalAnd)*
 *   LogicalAnd   = Equality ("&&" Equality)*
 *   Equality     = Comparison (("===" | "!==") Comparison)*
 *   Comparison   = Addition ((">" | "<" | ">=" | "<=") Addition)*
 *   Addition     = Multiplication (("+" | "-") Multiplication)*
 *   Multiplication = Unary (("*" | "/" | "%") Unary)*
 *   Unary        = ("!" | "-") Unary | Primary
 *   Primary      = Literal | TemplateLiteral | ArrayLiteral | ObjectLiteral
 *                | IdentifierExpr (may resolve to TaskCall, WorkflowCall, BuiltinCall)
 *                | "(" Expr ")" (parenthesized or arrow function start)
 */

import { Token, TokenKind } from "./lexer.js";
import {
    WorkflowDecl,
    ParamDecl,
    TypeExpr,
    Statement,
    ConstStatement,
    DestructuringConst,
    IfStatement,
    SwitchStatement,
    SwitchArm,
    ThrowStatement,
    ReturnStatement,
    BreakStatement,
    Expr,
    TaskArg,
    ObjectEntry,
    SourceLocation,
    BinaryOp,
    RetryNode,
    ParallelNode,
    ParallelMapNode,
} from "./ast.js";

/** Names recognized as compiler built-in functions. */
const BUILTIN_NAMES = new Set([
    "retry",
    "map",
    "filter",
    "parallel",
    "parallelMap",
]);

/**
 * Internal placeholder for a parsed arrow function.
 * Not a real AST node: only used by built-in parsers to extract
 * parameter names and body statements.
 */
interface ArrowPlaceholder {
    _isArrow: true;
    params: string[];
    body: Statement[];
}

export interface ParseError {
    message: string;
    line: number;
    col: number;
}

export class Parser {
    private pos = 0;
    private errors: ParseError[] = [];
    private inSwitchDepth = 0;

    constructor(private tokens: Token[]) {}

    parse(): { workflows: WorkflowDecl[]; errors: ParseError[] } {
        const workflows: WorkflowDecl[] = [];
        while (this.peek().kind !== TokenKind.EOF) {
            const wf = this.parseWorkflow();
            if (wf) workflows.push(wf);
        }
        return { workflows, errors: this.errors };
    }

    /** Parse a single workflow (backward compat). */
    parseSingle(): { ast: WorkflowDecl | undefined; errors: ParseError[] } {
        const ast = this.parseWorkflow();
        return { ast, errors: this.errors };
    }

    private peek(): Token {
        return this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1];
    }

    private peekAt(offset: number): Token {
        const idx = this.pos + offset;
        return this.tokens[idx] ?? this.tokens[this.tokens.length - 1];
    }

    private advance(): Token {
        const t = this.tokens[this.pos];
        if (this.pos < this.tokens.length - 1) {
            this.pos++;
        }
        return t;
    }

    private expect(kind: TokenKind): Token {
        const t = this.peek();
        if (t.kind !== kind) {
            this.error(
                `Expected ${kind}, got ${t.kind} (${JSON.stringify(t.value)})`,
            );
            // Advance past the unexpected token to prevent infinite loops
            if (t.kind !== TokenKind.EOF) {
                this.advance();
            }
            return t;
        }
        return this.advance();
    }

    private error(msg: string): void {
        const t = this.peek();
        this.errors.push({ message: msg, line: t.line, col: t.col });
    }

    private loc(): SourceLocation {
        const t = this.peek();
        return { line: t.line, col: t.col, offset: t.offset };
    }

    /** Consume an optional semicolon (ASI). */
    private optionalSemicolon(): void {
        if (this.peek().kind === TokenKind.Semicolon) {
            this.advance();
        }
    }

    // ---- Workflow ----

    private parseWorkflow(): WorkflowDecl | undefined {
        const l = this.loc();
        if (this.peek().kind !== TokenKind.Workflow) {
            this.error(`Expected 'workflow', got ${this.peek().kind}`);
            this.advance();
            return undefined;
        }
        this.advance();
        const name = this.expect(TokenKind.Identifier).value;
        this.expect(TokenKind.LParen);
        const params = this.parseParamList();
        this.expect(TokenKind.RParen);
        this.expect(TokenKind.Colon);
        const returnType = this.parseTypeExpr();
        this.expect(TokenKind.LBrace);
        const body = this.parseStatements();
        this.expect(TokenKind.RBrace);
        return { kind: "WorkflowDecl", name, params, returnType, body, loc: l };
    }

    private parseParamList(): ParamDecl[] {
        const params: ParamDecl[] = [];
        if (this.peek().kind === TokenKind.RParen) return params;
        params.push(this.parseParam());
        while (this.peek().kind === TokenKind.Comma) {
            this.advance();
            if (this.peek().kind === TokenKind.RParen) break;
            params.push(this.parseParam());
        }
        return params;
    }

    private parseParam(): ParamDecl {
        const l = this.loc();
        const name = this.expect(TokenKind.Identifier).value;
        this.expect(TokenKind.Colon);
        const type = this.parseTypeExpr();
        return { name, type, loc: l };
    }

    // ---- Types ----

    private parseTypeExpr(): TypeExpr {
        let t = this.parseBaseType();
        while (this.peek().kind === TokenKind.LBracket) {
            const l = t.loc;
            this.advance(); // [
            this.expect(TokenKind.RBracket); // ]
            t = { kind: "ArrayType", element: t, loc: l };
        }
        return t;
    }

    private parseBaseType(): TypeExpr {
        const l = this.loc();
        if (this.peek().kind === TokenKind.LBrace) {
            return this.parseObjectType();
        }
        const name = this.expect(TokenKind.Identifier).value;
        return { kind: "NamedType", name, loc: l };
    }

    private parseObjectType(): TypeExpr {
        const l = this.loc();
        this.expect(TokenKind.LBrace);
        const fields: {
            name: string;
            type: TypeExpr;
            optional: boolean;
            loc: SourceLocation;
        }[] = [];
        while (
            this.peek().kind !== TokenKind.RBrace &&
            this.peek().kind !== TokenKind.EOF
        ) {
            const fl = this.loc();
            const fname = this.expect(TokenKind.Identifier).value;
            let optional = false;
            if (this.peek().kind === TokenKind.QuestionMark) {
                this.advance();
                optional = true;
            }
            this.expect(TokenKind.Colon);
            const ftype = this.parseTypeExpr();
            fields.push({ name: fname, type: ftype, optional, loc: fl });
            if (this.peek().kind === TokenKind.Comma) {
                this.advance();
            }
        }
        this.expect(TokenKind.RBrace);
        return { kind: "ObjectType", fields, loc: l };
    }

    // ---- Statements ----

    private parseStatements(): Statement[] {
        const stmts: Statement[] = [];
        while (
            this.peek().kind !== TokenKind.RBrace &&
            this.peek().kind !== TokenKind.EOF
        ) {
            const s = this.parseStatement();
            if (s) stmts.push(s);
        }
        return stmts;
    }

    private parseStatement(): Statement | undefined {
        switch (this.peek().kind) {
            case TokenKind.Const:
                return this.parseConstOrDestructuring();
            case TokenKind.If:
                return this.parseIfStmt();
            case TokenKind.Switch:
                return this.parseSwitchStmt();
            case TokenKind.Return:
                return this.parseReturnStmt();
            case TokenKind.Break:
                return this.parseBreakStmt();
            case TokenKind.Throw:
                return this.parseThrowStmt();
            case TokenKind.Identifier: {
                // Expression statement: bare task call or workflow call
                // (side-effect only, no binding)
                const expr = this.parseExpression();
                this.optionalSemicolon();
                // Wrap as a const with no binding? No: v2 allows bare calls
                // as expression statements. The emitter handles them.
                // For now, error: bare expressions are not statements
                // Actually, v2 allows bare task calls for side effects
                // (e.g., audit.log(data) in an if body). Wrap in a const
                // with a synthetic name.
                return {
                    kind: "ConstStatement",
                    name: `_${expr.loc.line}_${expr.loc.col}`,
                    value: expr,
                    loc: expr.loc,
                };
            }
            default:
                this.error(`Unexpected token: ${this.peek().kind}`);
                this.advance();
                return undefined;
        }
    }

    private parseConstOrDestructuring(): ConstStatement | DestructuringConst {
        const l = this.loc();
        this.expect(TokenKind.Const);

        // Destructuring: const [a, b, c] = expr
        if (this.peek().kind === TokenKind.LBracket) {
            return this.parseDestructuringConst(l);
        }

        const name = this.expect(TokenKind.Identifier).value;
        let typeAnnotation: TypeExpr | undefined;
        if (this.peek().kind === TokenKind.Colon) {
            this.advance();
            typeAnnotation = this.parseTypeExpr();
        }
        this.expect(TokenKind.Equals);
        const value = this.parseExpression();
        this.optionalSemicolon();
        return { kind: "ConstStatement", name, typeAnnotation, value, loc: l };
    }

    private parseDestructuringConst(l: SourceLocation): DestructuringConst {
        this.expect(TokenKind.LBracket);
        const names: string[] = [];
        if (this.peek().kind !== TokenKind.RBracket) {
            names.push(this.expect(TokenKind.Identifier).value);
            while (this.peek().kind === TokenKind.Comma) {
                this.advance();
                if (this.peek().kind === TokenKind.RBracket) break;
                names.push(this.expect(TokenKind.Identifier).value);
            }
        }
        this.expect(TokenKind.RBracket);
        this.expect(TokenKind.Equals);
        const value = this.parseExpression();
        this.optionalSemicolon();
        return { kind: "DestructuringConst", names, value, loc: l };
    }

    private parseIfStmt(): IfStatement {
        const l = this.loc();
        this.expect(TokenKind.If);
        this.expect(TokenKind.LParen);
        const condition = this.parseExpression();
        this.expect(TokenKind.RParen);
        this.expect(TokenKind.LBrace);
        const then = this.parseStatements();
        this.expect(TokenKind.RBrace);
        let else_: Statement[] | undefined;
        if (this.peek().kind === TokenKind.Else) {
            this.advance();
            if (this.peek().kind === TokenKind.If) {
                // else if: wrap in single-element array
                const elseIf = this.parseIfStmt();
                else_ = [elseIf];
            } else {
                this.expect(TokenKind.LBrace);
                else_ = this.parseStatements();
                this.expect(TokenKind.RBrace);
            }
        }
        return { kind: "IfStatement", condition, then, else_, loc: l };
    }

    private parseSwitchStmt(): SwitchStatement {
        const l = this.loc();
        this.expect(TokenKind.Switch);
        this.expect(TokenKind.LParen);
        const discriminant = this.parseExpression();
        this.expect(TokenKind.RParen);
        this.expect(TokenKind.LBrace);

        const arms: SwitchArm[] = [];
        let default_: Statement[] | undefined;

        while (
            this.peek().kind !== TokenKind.RBrace &&
            this.peek().kind !== TokenKind.EOF
        ) {
            if (this.peek().kind === TokenKind.Case) {
                const armLoc = this.loc();
                this.advance(); // case
                const value = this.parsePrimaryExpr();
                this.expect(TokenKind.Colon);
                const body = this.parseSwitchArmBody();
                arms.push({ value, body, loc: armLoc });
            } else if (this.peek().kind === TokenKind.Default) {
                this.advance(); // default
                this.expect(TokenKind.Colon);
                default_ = this.parseSwitchArmBody();
            } else {
                this.error(
                    `Expected 'case' or 'default' in switch, got ${this.peek().kind}`,
                );
                this.advance();
            }
        }

        this.expect(TokenKind.RBrace);
        const result: SwitchStatement = {
            kind: "SwitchStatement",
            discriminant,
            arms,
            loc: l,
        };
        if (default_) result.default_ = default_;
        return result;
    }

    /** Parse statements until we hit another case/default/} */
    private parseSwitchArmBody(): Statement[] {
        this.inSwitchDepth++;
        const stmts: Statement[] = [];
        while (
            this.peek().kind !== TokenKind.Case &&
            this.peek().kind !== TokenKind.Default &&
            this.peek().kind !== TokenKind.RBrace &&
            this.peek().kind !== TokenKind.EOF
        ) {
            const s = this.parseStatement();
            if (s) stmts.push(s);
        }
        this.inSwitchDepth--;
        return stmts;
    }

    private parseReturnStmt(): ReturnStatement {
        const l = this.loc();
        this.expect(TokenKind.Return);
        const value = this.parseExpression();
        this.optionalSemicolon();
        return { kind: "ReturnStatement", value, loc: l };
    }

    private parseBreakStmt(): BreakStatement {
        const l = this.loc();
        this.expect(TokenKind.Break);
        if (this.inSwitchDepth === 0) {
            this.error("'break' is only allowed inside switch arms");
        }
        this.optionalSemicolon();
        return { kind: "BreakStatement", loc: l };
    }

    private parseThrowStmt(): ThrowStatement {
        const l = this.loc();
        this.expect(TokenKind.Throw);
        const value = this.parseExpression();
        this.optionalSemicolon();
        return { kind: "ThrowStatement", value, loc: l };
    }

    // ---- Expressions (precedence climbing) ----

    private parseExpression(): Expr {
        return this.parseTernary();
    }

    private parseTernary(): Expr {
        const expr = this.parseLogicalOr();
        if (this.peek().kind === TokenKind.QuestionMark) {
            const l = expr.loc;
            this.advance(); // ?
            const consequent = this.parseExpression();
            this.expect(TokenKind.Colon);
            const alternate = this.parseExpression();
            return {
                kind: "TernaryExpr",
                condition: expr,
                consequent,
                alternate,
                loc: l,
            };
        }
        return expr;
    }

    private parseLogicalOr(): Expr {
        let left = this.parseLogicalAnd();
        while (this.peek().kind === TokenKind.Or) {
            const l = left.loc;
            this.advance();
            const right = this.parseLogicalAnd();
            left = {
                kind: "BinaryExpr",
                op: "||" as BinaryOp,
                left,
                right,
                loc: l,
            };
        }
        return left;
    }

    private parseLogicalAnd(): Expr {
        let left = this.parseEquality();
        while (this.peek().kind === TokenKind.And) {
            const l = left.loc;
            this.advance();
            const right = this.parseEquality();
            left = {
                kind: "BinaryExpr",
                op: "&&" as BinaryOp,
                left,
                right,
                loc: l,
            };
        }
        return left;
    }

    private parseEquality(): Expr {
        let left = this.parseComparison();
        while (
            this.peek().kind === TokenKind.TripleEquals ||
            this.peek().kind === TokenKind.NotTripleEquals
        ) {
            const l = left.loc;
            const op = this.advance().value as BinaryOp;
            const right = this.parseComparison();
            left = { kind: "BinaryExpr", op, left, right, loc: l };
        }
        return left;
    }

    private parseComparison(): Expr {
        let left = this.parseAddition();
        while (
            this.peek().kind === TokenKind.GreaterThan ||
            this.peek().kind === TokenKind.LessThan ||
            this.peek().kind === TokenKind.GreaterOrEqual ||
            this.peek().kind === TokenKind.LessOrEqual
        ) {
            const l = left.loc;
            const op = this.advance().value as BinaryOp;
            const right = this.parseAddition();
            left = { kind: "BinaryExpr", op, left, right, loc: l };
        }
        return left;
    }

    private parseAddition(): Expr {
        let left = this.parseMultiplication();
        while (
            this.peek().kind === TokenKind.Plus ||
            this.peek().kind === TokenKind.Minus
        ) {
            const l = left.loc;
            const op = this.advance().value as BinaryOp;
            const right = this.parseMultiplication();
            left = { kind: "BinaryExpr", op, left, right, loc: l };
        }
        return left;
    }

    private parseMultiplication(): Expr {
        let left = this.parseUnary();
        while (
            this.peek().kind === TokenKind.Star ||
            this.peek().kind === TokenKind.Slash ||
            this.peek().kind === TokenKind.Percent
        ) {
            const l = left.loc;
            const op = this.advance().value as BinaryOp;
            const right = this.parseUnary();
            left = { kind: "BinaryExpr", op, left, right, loc: l };
        }
        return left;
    }

    private parseUnary(): Expr {
        if (this.peek().kind === TokenKind.Not) {
            const l = this.loc();
            this.advance();
            const operand = this.parseUnary();
            return { kind: "UnaryExpr", op: "!", operand, loc: l };
        }
        if (this.peek().kind === TokenKind.Minus) {
            // Unary minus: only if not followed by a number (negative number
            // literals are handled by the lexer)
            const l = this.loc();
            this.advance();
            const operand = this.parseUnary();
            return { kind: "UnaryExpr", op: "-", operand, loc: l };
        }
        return this.parsePrimaryExpr();
    }

    // ---- Primary expressions ----

    private parsePrimaryExpr(): Expr {
        const l = this.loc();
        const t = this.peek();

        // Parenthesized expression or arrow function
        if (t.kind === TokenKind.LParen) {
            return this.parseParenOrArrowExpr();
        }

        // Array literal
        if (t.kind === TokenKind.LBracket) {
            return this.parseArrayLiteral();
        }

        // Object literal
        if (t.kind === TokenKind.LBrace) {
            return this.parseObjectLiteral();
        }

        // String
        if (t.kind === TokenKind.StringLiteral) {
            const v = this.advance();
            return { kind: "StringLiteralExpr", value: v.value, loc: l };
        }

        // Template literal (no interpolation): `text`
        if (t.kind === TokenKind.TemplateNoSub) {
            const v = this.advance();
            return { kind: "StringLiteralExpr", value: v.value, loc: l };
        }

        // Template literal (with interpolation): `text${expr}...`
        if (t.kind === TokenKind.TemplateHead) {
            return this.parseTemplateLiteral();
        }

        // Number
        if (t.kind === TokenKind.NumberLiteral) {
            const v = this.advance();
            return {
                kind: "NumberLiteralExpr",
                value: Number(v.value),
                loc: l,
            };
        }

        // Boolean
        if (t.kind === TokenKind.BooleanLiteral) {
            const v = this.advance();
            return {
                kind: "BooleanLiteralExpr",
                value: v.value === "true",
                loc: l,
            };
        }

        // Null
        if (t.kind === TokenKind.NullLiteral) {
            this.advance();
            return { kind: "NullLiteralExpr", loc: l };
        }

        // Identifier: task call, workflow call, builtin, or dotted name
        if (t.kind === TokenKind.Identifier) {
            return this.parseIdentifierExpr();
        }

        this.error(`Unexpected token in expression: ${t.kind}`);
        this.advance();
        return { kind: "NullLiteralExpr", loc: l };
    }

    /**
     * Parse parenthesized expression or arrow function.
     * Arrow function: () => { body } or (params) => expr
     * Parenthesized: (expr)
     */
    private parseParenOrArrowExpr(): Expr {
        // Parenthesized expression (arrow functions are only parsed via
        // parseArrowArg inside built-in calls)
        this.advance(); // (
        const expr = this.parseExpression();
        this.expect(TokenKind.RParen);
        return expr;
    }

    /**
     * Parse an arrow function argument for built-in calls.
     * Tries arrow function patterns first, falls back to expression.
     */
    private parseArrowArg(): Expr | ArrowPlaceholder {
        const l = this.loc();

        if (this.peek().kind !== TokenKind.LParen) {
            return this.parseExpression();
        }

        // () => ... (empty params arrow)
        if (this.peekAt(1).kind === TokenKind.RParen) {
            // Could be () => { ... } or just ()
            const savedPos = this.pos;
            this.advance(); // (
            this.advance(); // )
            if (this.peek().kind === TokenKind.Arrow) {
                this.advance(); // =>
                return this.parseArrowBody([], l);
            }
            // Not an arrow, backtrack (shouldn't normally happen)
            this.pos = savedPos;
        }

        // (ident) => ... or (ident, ident) => ...
        // Try to parse as arrow function
        if (this.peekAt(1).kind === TokenKind.Identifier) {
            const savedPos = this.pos;
            this.advance(); // (
            const params: string[] = [];
            params.push(this.advance().value);
            let isArrow = true;
            while (this.peek().kind === TokenKind.Comma) {
                this.advance();
                if (this.peek().kind === TokenKind.Identifier) {
                    params.push(this.advance().value);
                } else {
                    isArrow = false;
                    break;
                }
            }
            if (isArrow && this.peek().kind === TokenKind.RParen) {
                this.advance(); // )
                if (this.peek().kind === TokenKind.Arrow) {
                    this.advance(); // =>
                    return this.parseArrowBody(params, l);
                }
            }
            // Backtrack: not an arrow function, parse as parenthesized expr
            this.pos = savedPos;
        }

        // Parenthesized expression
        this.advance(); // (
        const expr = this.parseExpression();
        this.expect(TokenKind.RParen);
        return expr;
    }

    /**
     * Parse the body of an arrow function: { statements } or single expression.
     * Returns an ArrowPlaceholder (not a real AST node) that the built-in
     * parsers extract params/body from.
     */
    private parseArrowBody(
        params: string[],
        _l: SourceLocation,
    ): ArrowPlaceholder {
        if (this.peek().kind === TokenKind.LBrace) {
            this.advance(); // {
            const body = this.parseStatements();
            this.expect(TokenKind.RBrace);
            return { _isArrow: true, params, body };
        }
        // Single expression body: wrap in return statement
        const expr = this.parseExpression();
        return {
            _isArrow: true,
            params,
            body: [{ kind: "ReturnStatement", value: expr, loc: expr.loc }],
        };
    }

    private parseIdentifierExpr(): Expr {
        const l = this.loc();
        const firstName = this.advance().value; // first identifier

        // Check if this is a builtin function call
        if (
            BUILTIN_NAMES.has(firstName) &&
            this.peek().kind === TokenKind.LParen
        ) {
            return this.parseBuiltinCall(firstName, l);
        }

        // Collect dotted segments
        const segments: string[] = [firstName];
        while (this.peek().kind === TokenKind.Dot) {
            this.advance(); // .
            if (this.peek().kind === TokenKind.Identifier) {
                segments.push(this.advance().value);
            } else {
                this.error("Expected identifier after '.'");
                break;
            }
        }

        // If followed by (, this is a task call or workflow call
        if (this.peek().kind === TokenKind.LParen) {
            const name = segments.join(".");
            this.advance(); // (
            const args = this.parseArgList();
            this.expect(TokenKind.RParen);

            // Workflow call: single-segment name (no dots)
            if (segments.length === 1) {
                return { kind: "WorkflowCallExpr", name, args, loc: l };
            }
            return { kind: "TaskCallExpr", task: name, args, loc: l };
        }

        // Otherwise it's a dotted name reference
        return { kind: "DottedNameExpr", segments, loc: l };
    }

    // ---- Built-in function parsing ----

    private parseBuiltinCall(name: string, l: SourceLocation): Expr {
        this.expect(TokenKind.LParen);

        switch (name) {
            case "retry":
                return this.parseRetryBuiltin(l);
            case "map":
                return this.parseMapBuiltin(l);
            case "filter":
                return this.parseFilterBuiltin(l);
            case "parallel":
                return this.parseParallelBuiltin(l);
            case "parallelMap":
                return this.parseParallelMapBuiltin(l);
            default:
                this.error(`Unknown built-in: ${name}`);
                this.expect(TokenKind.RParen);
                return { kind: "NullLiteralExpr", loc: l };
        }
    }

    /** retry(count, () => { body }, (err) => { fallback })  */
    private parseRetryBuiltin(l: SourceLocation): Expr {
        const count = this.parseExpression();
        this.expect(TokenKind.Comma);
        const bodyArrow = this.parseArrowArg();
        const body = this.extractArrowBody(bodyArrow);

        let fallback: { param: string; body: Statement[] } | undefined;
        if (this.peek().kind === TokenKind.Comma) {
            this.advance();
            if (this.peek().kind !== TokenKind.RParen) {
                const fbArrow = this.parseArrowArg();
                const fbParams = this.extractArrowParams(fbArrow);
                fallback = {
                    param: fbParams[0] ?? "err",
                    body: this.extractArrowBody(fbArrow),
                };
            }
        }

        this.expect(TokenKind.RParen);
        const result: RetryNode = { kind: "RetryNode", count, body, loc: l };
        if (fallback) result.fallback = fallback;
        return result;
    }

    /** map(collection, (item) => { body }) */
    private parseMapBuiltin(l: SourceLocation): Expr {
        const collection = this.parseExpression();
        this.expect(TokenKind.Comma);
        const bodyArrow = this.parseArrowArg();
        const params = this.extractArrowParams(bodyArrow);
        const body = this.extractArrowBody(bodyArrow);
        this.expect(TokenKind.RParen);
        return {
            kind: "MapNode",
            collection,
            param: params[0] ?? "item",
            body,
            loc: l,
        };
    }

    /** filter(collection, (item) => { body }) */
    private parseFilterBuiltin(l: SourceLocation): Expr {
        const collection = this.parseExpression();
        this.expect(TokenKind.Comma);
        const bodyArrow = this.parseArrowArg();
        const params = this.extractArrowParams(bodyArrow);
        const body = this.extractArrowBody(bodyArrow);
        this.expect(TokenKind.RParen);
        return {
            kind: "FilterNode",
            collection,
            param: params[0] ?? "item",
            body,
            loc: l,
        };
    }

    /** parallel(() => expr1, () => expr2, ..., { maxConcurrency: n }?) */
    private parseParallelBuiltin(l: SourceLocation): Expr {
        const bodies: { body: Statement[] }[] = [];
        let maxConcurrency: Expr | undefined;

        while (
            this.peek().kind !== TokenKind.RParen &&
            this.peek().kind !== TokenKind.EOF
        ) {
            // Check if this is the options object (last arg, starts with {)
            if (this.peek().kind === TokenKind.LBrace) {
                const opts = this.parseObjectLiteral();
                if (opts.kind === "ObjectLiteralExpr") {
                    const mc = opts.entries.find(
                        (e) => e.key === "maxConcurrency",
                    );
                    if (mc) maxConcurrency = mc.value;
                }
                if (this.peek().kind === TokenKind.Comma) this.advance();
                continue;
            }

            const arrow = this.parseArrowArg();
            bodies.push({ body: this.extractArrowBody(arrow) });
            if (this.peek().kind === TokenKind.Comma) {
                this.advance();
            }
        }
        this.expect(TokenKind.RParen);
        const result: ParallelNode = { kind: "ParallelNode", bodies, loc: l };
        if (maxConcurrency) result.maxConcurrency = maxConcurrency;
        return result;
    }

    /** parallelMap(collection, (item) => { body }, { maxConcurrency: n }?) */
    private parseParallelMapBuiltin(l: SourceLocation): Expr {
        const collection = this.parseExpression();
        this.expect(TokenKind.Comma);
        const bodyArrow = this.parseArrowArg();
        const params = this.extractArrowParams(bodyArrow);
        const body = this.extractArrowBody(bodyArrow);

        let maxConcurrency: Expr | undefined;
        if (this.peek().kind === TokenKind.Comma) {
            this.advance();
            if (this.peek().kind === TokenKind.LBrace) {
                const opts = this.parseObjectLiteral();
                if (opts.kind === "ObjectLiteralExpr") {
                    const mc = opts.entries.find(
                        (e) => e.key === "maxConcurrency",
                    );
                    if (mc) maxConcurrency = mc.value;
                }
            }
        }

        this.expect(TokenKind.RParen);
        const result: ParallelMapNode = {
            kind: "ParallelMapNode",
            collection,
            param: params[0] ?? "item",
            body,
            loc: l,
        };
        if (maxConcurrency) result.maxConcurrency = maxConcurrency;
        return result;
    }

    /** Extract body statements from a parsed arrow. Falls back to wrapping expr as return. */
    private extractArrowBody(arg: Expr | ArrowPlaceholder): Statement[] {
        if (this.isArrow(arg)) {
            return arg.body;
        }
        return [{ kind: "ReturnStatement", value: arg, loc: arg.loc }];
    }

    /** Extract parameter names from a parsed arrow. */
    private extractArrowParams(arg: Expr | ArrowPlaceholder): string[] {
        if (this.isArrow(arg)) {
            return arg.params;
        }
        return [];
    }

    private isArrow(arg: Expr | ArrowPlaceholder): arg is ArrowPlaceholder {
        return (arg as ArrowPlaceholder)._isArrow === true;
    }

    // ---- Helpers ----

    private parseTemplateLiteral(): Expr {
        const l = this.loc();
        const parts: string[] = [];
        const expressions: Expr[] = [];

        const head = this.expect(TokenKind.TemplateHead);
        parts.push(head.value);

        while (true) {
            expressions.push(this.parseExpression());

            if (this.peek().kind === TokenKind.TemplateTail) {
                const tail = this.advance();
                parts.push(tail.value);
                break;
            } else if (this.peek().kind === TokenKind.TemplateMiddle) {
                const mid = this.advance();
                parts.push(mid.value);
            } else {
                this.error(
                    "Expected template continuation or closing backtick",
                );
                break;
            }
        }

        return {
            kind: "TemplateLiteralExpr",
            parts,
            expressions,
            loc: l,
        };
    }

    private parseArgList(): TaskArg[] {
        const args: TaskArg[] = [];
        if (this.peek().kind === TokenKind.RParen) return args;

        args.push(this.parseArg());
        while (this.peek().kind === TokenKind.Comma) {
            this.advance();
            if (this.peek().kind === TokenKind.RParen) break;
            args.push(this.parseArg());
        }
        return args;
    }

    private parseArg(): TaskArg {
        // Check for named arg: IDENT ":" Expr
        if (this.peek().kind === TokenKind.Identifier) {
            const savedPos = this.pos;
            const name = this.advance();
            if (this.peek().kind === TokenKind.Colon) {
                this.advance(); // :
                const value = this.parseExpression();
                return { kind: "NamedArg", name: name.value, value };
            }
            // Backtrack: not a named arg
            this.pos = savedPos;
        }
        const value = this.parseExpression();
        return { kind: "PositionalArg", value };
    }

    private parseArrayLiteral(): Expr {
        const l = this.loc();
        this.expect(TokenKind.LBracket);
        const elements: Expr[] = [];
        while (
            this.peek().kind !== TokenKind.RBracket &&
            this.peek().kind !== TokenKind.EOF
        ) {
            elements.push(this.parseExpression());
            if (this.peek().kind === TokenKind.Comma) {
                this.advance();
            }
        }
        this.expect(TokenKind.RBracket);
        return { kind: "ArrayLiteralExpr", elements, loc: l };
    }

    private parseObjectLiteral(): Expr {
        const l = this.loc();
        this.expect(TokenKind.LBrace);
        const entries: ObjectEntry[] = [];
        while (
            this.peek().kind !== TokenKind.RBrace &&
            this.peek().kind !== TokenKind.EOF
        ) {
            const el = this.loc();
            const key = this.expect(TokenKind.Identifier).value;
            if (this.peek().kind === TokenKind.Colon) {
                this.advance();
                const value = this.parseExpression();
                entries.push({ key, value, loc: el });
            } else {
                // Shorthand: { repo } means { repo: repo }
                entries.push({
                    key,
                    value: { kind: "DottedNameExpr", segments: [key], loc: el },
                    loc: el,
                });
            }
            if (this.peek().kind === TokenKind.Comma) {
                this.advance();
            }
        }
        this.expect(TokenKind.RBrace);
        return { kind: "ObjectLiteralExpr", entries, loc: l };
    }
}
