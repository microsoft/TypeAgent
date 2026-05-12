// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Workflow DSL parser: tokens -> AST.
 *
 * Grammar (informal):
 *
 *   WorkflowDecl = "workflow" IDENT "(" ParamList ")" ":" TypeExpr "{" Statement* "}"
 *   ParamList    = Param ("," Param)*
 *   Param        = IDENT ":" TypeExpr
 *   TypeExpr     = BaseType ("[]")?
 *   BaseType     = "string" | "number" | "integer" | "boolean" | "any"
 *                | "{" FieldList "}"
 *   Statement    = LetStmt | ForOfStmt | IfStmt | MatchStmt | ReturnStmt
 *   LetStmt      = "let" IDENT (":" TypeExpr)? "=" Expr ";"
 *   ForOfStmt    = "for" "(" IDENT "of" Expr ")" "{" Statement* "}"
 *   IfStmt       = "if" Expr "{" Statement* "}" ("else" "{" Statement* "}")?
 *   MatchStmt    = "match" Expr "{" MatchCase* ("else" "{" Statement* "}")? "}"
 *   ReturnStmt   = "return" Expr ";"
 *   Expr         = TaskCall | ArrayLiteral | ObjectLiteral | Literal | DottedName
 *   TaskCall     = IDENT "." IDENT "(" ArgList ")"
 *   DottedName   = IDENT ("." IDENT)*
 */

import { Token, TokenKind } from "./lexer.js";
import {
    WorkflowDecl,
    ParamDecl,
    TypeExpr,
    Statement,
    LetStatement,
    AssignmentStatement,
    ForOfStatement,
    IfStatement,
    MatchStatement,
    MatchCase,
    ReturnStatement,
    Expr,
    TaskArg,
    ObjectEntry,
    SourceLocation,
} from "./ast.js";

export interface ParseError {
    message: string;
    line: number;
    col: number;
}

export class Parser {
    private pos = 0;
    private errors: ParseError[] = [];

    constructor(private tokens: Token[]) {}

    parse(): { ast: WorkflowDecl | undefined; errors: ParseError[] } {
        const ast = this.parseWorkflow();
        return { ast, errors: this.errors };
    }

    private peek(): Token {
        return this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1];
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

    // ---- Workflow ----

    private parseWorkflow(): WorkflowDecl | undefined {
        const l = this.loc();
        this.expect(TokenKind.Workflow);
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
        // Check for []
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
            case TokenKind.Let:
                return this.parseLetStmt();
            case TokenKind.For:
                return this.parseForOfStmt();
            case TokenKind.If:
                return this.parseIfStmt();
            case TokenKind.Match:
                return this.parseMatchStmt();
            case TokenKind.Return:
                return this.parseReturnStmt();
            case TokenKind.Identifier: {
                // Look ahead: IDENT "=" → assignment
                const savedPos = this.pos;
                this.advance();
                if (this.peek().kind === TokenKind.Equals) {
                    this.pos = savedPos;
                    return this.parseAssignmentStmt();
                }
                this.pos = savedPos;
                this.error(`Unexpected token: ${this.peek().kind}`);
                this.advance();
                return undefined;
            }
            default:
                this.error(`Unexpected token: ${this.peek().kind}`);
                this.advance();
                return undefined;
        }
    }

    private parseLetStmt(): LetStatement {
        const l = this.loc();
        this.expect(TokenKind.Let);
        const name = this.expect(TokenKind.Identifier).value;
        let typeAnnotation: TypeExpr | undefined;
        if (this.peek().kind === TokenKind.Colon) {
            this.advance();
            typeAnnotation = this.parseTypeExpr();
        }
        this.expect(TokenKind.Equals);
        const value = this.parseExpr();
        this.expect(TokenKind.Semicolon);
        return { kind: "LetStatement", name, typeAnnotation, value, loc: l };
    }

    private parseAssignmentStmt(): AssignmentStatement {
        const l = this.loc();
        const name = this.expect(TokenKind.Identifier).value;
        this.expect(TokenKind.Equals);
        const value = this.parseExpr();
        this.expect(TokenKind.Semicolon);
        return { kind: "AssignmentStatement", name, value, loc: l };
    }

    private parseForOfStmt(): ForOfStatement {
        const l = this.loc();
        this.expect(TokenKind.For);
        this.expect(TokenKind.LParen);
        const variable = this.expect(TokenKind.Identifier).value;
        this.expect(TokenKind.Of);
        const iterable = this.parseExpr();
        this.expect(TokenKind.RParen);
        this.expect(TokenKind.LBrace);
        const body = this.parseStatements();
        this.expect(TokenKind.RBrace);
        return { kind: "ForOfStatement", variable, iterable, body, loc: l };
    }

    private parseIfStmt(): IfStatement {
        const l = this.loc();
        this.expect(TokenKind.If);
        const condition = this.parseExpr();
        this.expect(TokenKind.LBrace);
        const then = this.parseStatements();
        this.expect(TokenKind.RBrace);
        let else_: Statement[] | undefined;
        if (this.peek().kind === TokenKind.Else) {
            this.advance();
            this.expect(TokenKind.LBrace);
            else_ = this.parseStatements();
            this.expect(TokenKind.RBrace);
        }
        return { kind: "IfStatement", condition, then, else_, loc: l };
    }

    private parseMatchStmt(): MatchStatement {
        const l = this.loc();
        this.expect(TokenKind.Match);
        const selector = this.parseExpr();
        this.expect(TokenKind.LBrace);
        const cases: MatchCase[] = [];
        let default_: Statement[] | undefined;
        while (
            this.peek().kind !== TokenKind.RBrace &&
            this.peek().kind !== TokenKind.EOF
        ) {
            if (this.peek().kind === TokenKind.Else) {
                this.advance();
                this.expect(TokenKind.Arrow);
                this.expect(TokenKind.LBrace);
                default_ = this.parseStatements();
                this.expect(TokenKind.RBrace);
            } else {
                const cl = this.loc();
                let pattern: string;
                if (this.peek().kind === TokenKind.StringLiteral) {
                    pattern = this.advance().value;
                } else if (this.peek().kind === TokenKind.NumberLiteral) {
                    pattern = this.advance().value;
                } else if (this.peek().kind === TokenKind.BooleanLiteral) {
                    pattern = this.advance().value;
                } else {
                    this.error("Expected match case pattern");
                    this.advance();
                    continue;
                }
                this.expect(TokenKind.Arrow);
                this.expect(TokenKind.LBrace);
                const body = this.parseStatements();
                this.expect(TokenKind.RBrace);
                cases.push({ pattern, body, loc: cl });
            }
        }
        this.expect(TokenKind.RBrace);
        return { kind: "MatchStatement", selector, cases, default_, loc: l };
    }

    private parseReturnStmt(): ReturnStatement {
        const l = this.loc();
        this.expect(TokenKind.Return);
        const value = this.parseExpr();
        this.expect(TokenKind.Semicolon);
        return { kind: "ReturnStatement", value, loc: l };
    }

    // ---- Expressions ----

    private parseExpr(): Expr {
        const l = this.loc();
        const t = this.peek();

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

        // Identifier: could be a task call (a.b(...)) or a dotted name (a.b.c)
        if (t.kind === TokenKind.Identifier) {
            return this.parseIdentifierExpr();
        }

        this.error(`Unexpected token in expression: ${t.kind}`);
        this.advance();
        return { kind: "NullLiteralExpr", loc: l };
    }

    private parseIdentifierExpr(): Expr {
        const l = this.loc();
        const segments: string[] = [this.advance().value]; // first identifier

        // Collect dotted segments
        while (this.peek().kind === TokenKind.Dot) {
            this.advance(); // .
            if (this.peek().kind === TokenKind.Identifier) {
                segments.push(this.advance().value);
            } else {
                this.error("Expected identifier after '.'");
                break;
            }
        }

        // If followed by (, this is a task call. The task name is the segments joined.
        if (this.peek().kind === TokenKind.LParen) {
            const taskName = segments.join(".");
            this.advance(); // (
            const args = this.parseArgList();
            this.expect(TokenKind.RParen);
            return { kind: "TaskCallExpr", task: taskName, args, loc: l };
        }

        // Otherwise it's a dotted name reference
        return { kind: "DottedNameExpr", segments, loc: l };
    }

    private parseTemplateLiteral(): Expr {
        const l = this.loc();
        const parts: string[] = [];
        const expressions: Expr[] = [];

        // First token is TemplateHead: `text${
        const head = this.expect(TokenKind.TemplateHead);
        parts.push(head.value);

        // Parse expression, then TemplateMiddle or TemplateTail
        while (true) {
            expressions.push(this.parseExpr());

            if (this.peek().kind === TokenKind.TemplateTail) {
                const tail = this.advance();
                parts.push(tail.value);
                break;
            } else if (this.peek().kind === TokenKind.TemplateMiddle) {
                const mid = this.advance();
                parts.push(mid.value);
                // continue to next expression
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

        // Peek ahead to see if first arg is named (IDENT: expr)
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
                const value = this.parseExpr();
                return { kind: "NamedArg", name: name.value, value };
            }
            // Backtrack: not a named arg
            this.pos = savedPos;
        }
        const value = this.parseExpr();
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
            elements.push(this.parseExpr());
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
                const value = this.parseExpr();
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
