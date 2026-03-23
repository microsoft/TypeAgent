// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Value expression parser for grammar rule values.
 *
 * Implements a recursive-descent / precedence-climbing parser for
 * JavaScript-like expressions in the value position (after `->`) of .agr
 * grammar rules.
 *
 * "ValueExpr" distinguishes these nodes from the *pattern-matching* side
 * of a grammar rule (the part before `->`) — these nodes represent the
 * *value-producing* side (after `->`).
 *
 * Operator precedence (lowest to highest):
 *   1. Ternary            ? :
 *   2. Nullish coalescing ??
 *   3. Logical OR         ||
 *   4. Logical AND        &&
 *   5. Equality           === !==
 *   6. Comparison         < > <= >=
 *   7. Additive           + -
 *   8. Multiplicative     * / %
 *   9. Unary              - ! typeof
 *  10. Postfix            . ?. [] ()
 *  11. Primary            literals, variables, objects, arrays, templates, (expr), ...expr
 */

import type { Comment, ValueNode } from "./grammarRuleParser.js";
import type { BinaryValueExprOp, UnaryValueExprOp } from "./grammarTypes.js";

// ── Parser-time value expression nodes (with comment annotations) ─────────────
// These define children as ValueNode (not CompiledValueNode) so that the
// compiler can recurse into expression children without unsafe casts.

type CommentFields = {
    pos?: number | undefined;
    leadingComments?: Comment[] | undefined;
    trailingComments?: Comment[] | undefined;
};

export type BinaryValueExprNode = {
    type: "binaryExpression";
    operator: BinaryValueExprOp;
    left: ValueNode;
    right: ValueNode;
} & CommentFields;

export type UnaryValueExprNode = {
    type: "unaryExpression";
    operator: UnaryValueExprOp;
    operand: ValueNode;
} & CommentFields;

export type ConditionalValueExprNode = {
    type: "conditionalExpression";
    test: ValueNode;
    consequent: ValueNode;
    alternate: ValueNode;
} & CommentFields;

export type MemberValueExprNode = {
    type: "memberExpression";
    object: ValueNode;
    property: string | ValueNode;
    computed: boolean;
    optional: boolean;
} & CommentFields;

export type CallValueExprNode = {
    type: "callExpression";
    callee: ValueNode;
    arguments: ValueNode[];
    optional?: boolean; // `?.()` optional call
} & CommentFields;

export type SpreadValueExprNode = {
    type: "spreadElement";
    argument: ValueNode;
} & CommentFields;

export type TemplateLiteralValueExprNode = {
    type: "templateLiteral";
    quasis: string[];
    expressions: ValueNode[];
} & CommentFields;

export type ValueExprNode =
    | BinaryValueExprNode
    | UnaryValueExprNode
    | ConditionalValueExprNode
    | MemberValueExprNode
    | CallValueExprNode
    | SpreadValueExprNode
    | TemplateLiteralValueExprNode;

// ── ValueNode with expression support ─────────────────────────────────────────
// Re-import the base ValueNode from the parser and extend it.
// We avoid circular imports by having the parser call us, not the other way.
// The parser's ValueNode is passed through parsePrimary() which handles
// existing types; expression nodes are new alternatives.

/**
 * Context interface exposing parser internals needed by the expression parser.
 * The GrammarRuleParser class implements this implicitly — we cast `this` to
 * it when delegating.
 */
export interface ValueExprParserContext {
    readonly content: string;
    curr: number;
    readonly position: boolean;

    isAt(expected: string): boolean;
    isAtEnd(): boolean;
    isAtStringDelimiter(): boolean;

    skipWhitespace(skip?: number): boolean;
    parseComments(): Comment[] | undefined;
    consume(expected: string, reason?: string): boolean;
    throwError(message: string, pos?: number): never;
    parseId(expected: string): string;
    parseStringLiteral(): string;
    parseNumberValue(): { type: "literal"; value: number };
    parseEscapedChar(): string;

    /** Whether the character at `pos` starts a number literal (single source of truth). */
    isNumberStart(pos: number): boolean;

    // For object/array parsing, we delegate to the existing parser.
    // The expression parser wraps these.
    parseObjectValue(): ValueNode;
    parseArrayValue(): ValueNode;
    parseValueWithComments(leadingComments?: Comment[]): ValueNode;
}

/**
 * Parse a value expression.
 * Entry point called from GrammarRuleParser.parseValue() when enableExpressions is true.
 */
export function parseValueExpr(ctx: ValueExprParserContext): ValueNode {
    return parseTernary(ctx);
}

// ── Precedence levels ─────────────────────────────────────────────────────────

function parseTernary(ctx: ValueExprParserContext): ValueNode {
    const test = parseNullishCoalescing(ctx);
    if (ctx.isAt("?") && !ctx.isAt("?.") && !ctx.isAt("??")) {
        ctx.skipWhitespace(1);
        const consequent = parseTernary(ctx); // right-associative
        ctx.consume(":", "in ternary expression");
        const alternate = parseTernary(ctx); // right-associative
        return {
            type: "conditionalExpression",
            test,
            consequent,
            alternate,
        } satisfies ConditionalValueExprNode;
    }
    return test;
}

function parseNullishCoalescing(ctx: ValueExprParserContext): ValueNode {
    let left = parseLogicalOr(ctx);
    while (ctx.isAt("??")) {
        const op: BinaryValueExprOp = "??";
        ctx.skipWhitespace(2);
        const right = parseLogicalOr(ctx);
        left = { type: "binaryExpression", operator: op, left, right };
    }
    return left;
}

function parseLogicalOr(ctx: ValueExprParserContext): ValueNode {
    let left = parseLogicalAnd(ctx);
    while (ctx.isAt("||")) {
        const op: BinaryValueExprOp = "||";
        ctx.skipWhitespace(2);
        const right = parseLogicalAnd(ctx);
        left = { type: "binaryExpression", operator: op, left, right };
    }
    return left;
}

function parseLogicalAnd(ctx: ValueExprParserContext): ValueNode {
    let left = parseEquality(ctx);
    while (ctx.isAt("&&")) {
        const op: BinaryValueExprOp = "&&";
        ctx.skipWhitespace(2);
        const right = parseEquality(ctx);
        left = { type: "binaryExpression", operator: op, left, right };
    }
    return left;
}

function parseEquality(ctx: ValueExprParserContext): ValueNode {
    let left = parseComparison(ctx);
    while (true) {
        let op: BinaryValueExprOp | undefined;
        if (ctx.isAt("===")) {
            op = "===";
            ctx.skipWhitespace(3);
        } else if (ctx.isAt("!==")) {
            op = "!==";
            ctx.skipWhitespace(3);
        } else {
            break;
        }
        const right = parseComparison(ctx);
        left = { type: "binaryExpression", operator: op, left, right };
    }
    return left;
}

function parseComparison(ctx: ValueExprParserContext): ValueNode {
    let left = parseAdditive(ctx);
    while (true) {
        let op: BinaryValueExprOp | undefined;
        let len = 0;
        if (ctx.isAt("<=")) {
            op = "<=";
            len = 2;
        } else if (ctx.isAt(">=")) {
            op = ">=";
            len = 2;
        } else if (ctx.isAt("<") && !ctx.isAt("<<")) {
            op = "<";
            len = 1;
        } else if (ctx.isAt(">") && !ctx.isAt(">>")) {
            op = ">";
            len = 1;
        } else {
            break;
        }
        ctx.skipWhitespace(len);
        const right = parseAdditive(ctx);
        left = { type: "binaryExpression", operator: op, left, right };
    }
    return left;
}

function parseAdditive(ctx: ValueExprParserContext): ValueNode {
    let left = parseMultiplicative(ctx);
    while (true) {
        let op: BinaryValueExprOp | undefined;
        // Careful: `-` followed by `>` is the arrow `->`, not subtraction.
        if (ctx.isAt("+")) {
            op = "+";
        } else if (ctx.isAt("-") && !ctx.isAt("->")) {
            op = "-";
        } else {
            break;
        }
        ctx.skipWhitespace(1);
        const right = parseMultiplicative(ctx);
        left = { type: "binaryExpression", operator: op, left, right };
    }
    return left;
}

function parseMultiplicative(ctx: ValueExprParserContext): ValueNode {
    let left = parseUnary(ctx);
    while (true) {
        let op: BinaryValueExprOp | undefined;
        if (ctx.isAt("*")) {
            op = "*";
        } else if (ctx.isAt("/") && !ctx.isAt("//") && !ctx.isAt("/*")) {
            op = "/";
        } else if (ctx.isAt("%")) {
            op = "%";
        } else {
            break;
        }
        ctx.skipWhitespace(1);
        const right = parseUnary(ctx);
        left = { type: "binaryExpression", operator: op, left, right };
    }
    return left;
}

function parseUnary(ctx: ValueExprParserContext): ValueNode {
    // typeof
    if (ctx.isAt("typeof") && !isIdContinueAt(ctx, 6)) {
        ctx.skipWhitespace(6);
        const operand = parseUnary(ctx);
        return {
            type: "unaryExpression",
            operator: "typeof" as UnaryValueExprOp,
            operand,
        } satisfies UnaryValueExprNode;
    }

    // ! (prefix)
    if (ctx.isAt("!") && !ctx.isAt("!=")) {
        ctx.skipWhitespace(1);
        const operand = parseUnary(ctx);
        return {
            type: "unaryExpression",
            operator: "!" as UnaryValueExprOp,
            operand,
        } satisfies UnaryValueExprNode;
    }

    // Unary - must distinguish `-3` (negative number literal) from `-x`
    // (unary minus on variable).  We peek ahead: if the next non-space
    // character starts a number, fall through to parsePrimary so the
    // parser's parseNumberValue handles the sign.  The authoritative
    // check is ctx.isNumberStart, defined by the parser itself.
    if (ctx.isAt("-") && !ctx.isAt("->")) {
        const savedPos = ctx.curr;
        ctx.curr++;
        // Skip whitespace manually to peek
        let peekPos = ctx.curr;
        while (
            peekPos < ctx.content.length &&
            /\s/.test(ctx.content[peekPos])
        ) {
            peekPos++;
        }
        if (ctx.isNumberStart(peekPos)) {
            ctx.curr = savedPos;
            return parsePostfix(ctx);
        }
        // It's a unary operator
        ctx.curr = savedPos;
        ctx.skipWhitespace(1);
        const operand = parseUnary(ctx);
        return {
            type: "unaryExpression",
            operator: "-" as UnaryValueExprOp,
            operand,
        } satisfies UnaryValueExprNode;
    }

    return parsePostfix(ctx);
}

function parsePostfix(ctx: ValueExprParserContext): ValueNode {
    let expr = parsePrimary(ctx);

    while (true) {
        // Optional chaining: ?.prop or ?.[expr] or ?.()
        if (ctx.isAt("?.")) {
            ctx.skipWhitespace(2);
            if (ctx.isAt("[")) {
                // ?.[expr]
                ctx.skipWhitespace(1);
                const property = parseTernary(ctx);
                ctx.consume("]", "in computed member expression");
                expr = {
                    type: "memberExpression",
                    object: expr,
                    property,
                    computed: true,
                    optional: true,
                } satisfies MemberValueExprNode;
            } else if (ctx.isAt("(")) {
                // ?.(args)
                expr = {
                    type: "callExpression",
                    callee: expr,
                    arguments: parseCallArguments(ctx),
                    optional: true,
                } satisfies CallValueExprNode;
            } else {
                // ?.prop or ?.method(args)
                const prop = ctx.parseId("property name after ?.");
                if (ctx.isAt("(")) {
                    // ?.method(args)
                    const callee = {
                        type: "memberExpression",
                        object: expr,
                        property: prop,
                        computed: false,
                        optional: true,
                    } satisfies MemberValueExprNode;
                    expr = {
                        type: "callExpression",
                        callee,
                        arguments: parseCallArguments(ctx),
                    } satisfies CallValueExprNode;
                } else {
                    expr = {
                        type: "memberExpression",
                        object: expr,
                        property: prop,
                        computed: false,
                        optional: true,
                    } satisfies MemberValueExprNode;
                }
            }
            continue;
        }

        // Dot access: .prop or .method(...)
        if (ctx.isAt(".") && !ctx.isAt("..")) {
            ctx.skipWhitespace(1);
            const prop = ctx.parseId("property name");
            if (ctx.isAt("(")) {
                // Method call: obj.method(args)
                const callee = {
                    type: "memberExpression",
                    object: expr,
                    property: prop,
                    computed: false,
                    optional: false,
                } satisfies MemberValueExprNode;
                expr = {
                    type: "callExpression",
                    callee,
                    arguments: parseCallArguments(ctx),
                } satisfies CallValueExprNode;
            } else {
                // Property access: obj.prop
                expr = {
                    type: "memberExpression",
                    object: expr,
                    property: prop,
                    computed: false,
                    optional: false,
                } satisfies MemberValueExprNode;
            }
            continue;
        }

        // Computed member access: obj[expr]
        if (ctx.isAt("[")) {
            ctx.skipWhitespace(1);
            const property = parseTernary(ctx);
            ctx.consume("]", "in computed member expression");
            expr = {
                type: "memberExpression",
                object: expr,
                property,
                computed: true,
                optional: false,
            } satisfies MemberValueExprNode;
            continue;
        }

        // Function call: expr(args) — currently only via .method(args) above,
        // but this handles the case where the callee is already a member expr.
        // Note: free function calls are NOT supported — only method calls.

        break;
    }

    return expr;
}

function parseCallArguments(ctx: ValueExprParserContext): ValueNode[] {
    ctx.skipWhitespace(1); // skip "("
    const args: ValueNode[] = [];
    if (!ctx.isAt(")")) {
        args.push(parseTernary(ctx));
        while (ctx.isAt(",")) {
            ctx.skipWhitespace(1);
            args.push(parseTernary(ctx));
        }
    }
    ctx.consume(")", "in call expression arguments");
    return args;
}

function parsePrimary(ctx: ValueExprParserContext): ValueNode {
    // Spread: ...expr
    if (ctx.isAt("...")) {
        ctx.skipWhitespace(3);
        const argument = parseTernary(ctx);
        return {
            type: "spreadElement",
            argument,
        } satisfies SpreadValueExprNode;
    }

    // Template literal: `quasi${expr}quasi`
    if (ctx.isAt("`")) {
        return parseTemplateLiteral(ctx);
    }

    // Grouped expression: (expr)
    // Distinguish from the matching-side group by context: we're in value position.
    if (ctx.isAt("(")) {
        ctx.skipWhitespace(1);
        const expr = parseTernary(ctx);
        ctx.consume(")", "in grouped expression");
        return expr;
    }

    // Object literal: { ... }
    if (ctx.isAt("{")) {
        return ctx.parseObjectValue();
    }

    // Array literal: [ ... ]
    if (ctx.isAt("[")) {
        return ctx.parseArrayValue();
    }

    // String literal
    if (ctx.isAtStringDelimiter()) {
        return { type: "literal", value: ctx.parseStringLiteral() };
    }

    // Boolean literals
    if (ctx.isAt("true") && !isIdContinueAt(ctx, 4)) {
        ctx.skipWhitespace(4);
        return { type: "literal", value: true };
    }
    if (ctx.isAt("false") && !isIdContinueAt(ctx, 5)) {
        ctx.skipWhitespace(5);
        return { type: "literal", value: false };
    }

    // typeof is handled in parseUnary; "Infinity" falls through to number

    // Identifier (variable reference) — must check before number since numbers
    // can't start with ID_Start chars (except Infinity which we exclude).
    if (
        !ctx.isAtEnd() &&
        isIdStartChar(ctx.content[ctx.curr]) &&
        !ctx.isAt("Infinity")
    ) {
        const id = ctx.parseId("Variable name");
        return { type: "variable", name: id };
    }

    // Number literal
    return ctx.parseNumberValue();
}

function parseTemplateLiteral(
    ctx: ValueExprParserContext,
): TemplateLiteralValueExprNode {
    ctx.curr++; // skip opening backtick
    const quasis: string[] = [];
    const expressions: ValueNode[] = [];
    const chars: string[] = [];

    while (true) {
        if (ctx.isAtEnd()) {
            ctx.throwError("Unterminated template literal.");
        }

        const ch = ctx.content[ctx.curr];

        if (ch === "`") {
            // End of template
            quasis.push(chars.join(""));
            ctx.curr++;
            ctx.skipWhitespace();
            return {
                type: "templateLiteral",
                quasis,
                expressions,
            } satisfies TemplateLiteralValueExprNode;
        }

        if (
            ch === "$" &&
            ctx.curr + 1 < ctx.content.length &&
            ctx.content[ctx.curr + 1] === "{"
        ) {
            // Template expression: ${expr}
            quasis.push(chars.join(""));
            chars.length = 0;
            ctx.curr += 2; // skip "${"
            ctx.skipWhitespace();
            expressions.push(parseTernary(ctx));
            if (!ctx.isAt("}")) {
                ctx.throwError("Expected '}' to close template expression.");
            }
            ctx.curr++; // skip "}" — do NOT skipWhitespace, next chars are template content
            continue;
        }

        if (ch === "\\") {
            ctx.curr++;
            chars.push(ctx.parseEscapedChar());
            continue;
        }

        chars.push(ch);
        ctx.curr++;
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isIdStartChar(char: string): boolean {
    return /^\p{ID_Start}$/u.test(char);
}

function isIdContinueChar(char: string): boolean {
    return /^\p{ID_Continue}$/u.test(char);
}

/** Check if character at `pos + offset` from ctx.curr is an ID_Continue char. */
function isIdContinueAt(ctx: ValueExprParserContext, offset: number): boolean {
    const pos = ctx.curr + offset;
    return pos < ctx.content.length && isIdContinueChar(ctx.content[pos]);
}
