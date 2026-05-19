// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Workflow DSL token types and lexer.
 *
 * The DSL is a TypeScript-like language that compiles to workflow IR JSON.
 * Tokens are position-tracked for source-map generation.
 */

import { decodeStringLiteral, decodeTemplatePart } from "./literal.js";

export enum TokenKind {
    // Keywords
    Workflow = "workflow",
    Const = "const",
    If = "if",
    Else = "else",
    Switch = "switch",
    Case = "case",
    Default = "default",
    Return = "return",
    Break = "break",
    Throw = "throw",

    // Literals
    StringLiteral = "StringLiteral",
    NumberLiteral = "NumberLiteral",
    BooleanLiteral = "BooleanLiteral",
    NullLiteral = "NullLiteral",

    // Template literal parts (backtick strings with ${} interpolation)
    TemplateHead = "TemplateHead", // `` `text${ ``
    TemplateMiddle = "TemplateMiddle", // `` }text${ ``
    TemplateTail = "TemplateTail", // `` }text` ``
    TemplateNoSub = "TemplateNoSub", // `` `text` `` (no interpolation)

    // Identifiers and dotted paths
    Identifier = "Identifier",

    // Punctuation
    LParen = "(",
    RParen = ")",
    LBrace = "{",
    RBrace = "}",
    LBracket = "[",
    RBracket = "]",
    Colon = ":",
    Comma = ",",
    Dot = ".",
    Equals = "=",
    Arrow = "=>",
    Semicolon = ";",
    QuestionMark = "?",

    // Comparison operators
    TripleEquals = "===",
    NotTripleEquals = "!==",
    GreaterThan = ">",
    LessThan = "<",
    GreaterOrEqual = ">=",
    LessOrEqual = "<=",

    // Logical operators
    And = "&&",
    Or = "||",
    Not = "!",

    // Arithmetic operators
    Plus = "+",
    Minus = "-",
    Star = "*",
    Slash = "/",
    Percent = "%",

    // End
    EOF = "EOF",
}

export interface BaseToken {
    value: string;
    line: number;
    col: number;
    offset: number;
}

/**
 * String-literal token. Carries the original delimiter character so a
 * round-trip serializer can reproduce single-quoted vs. double-quoted
 * sources without guessing. Template tokens always use backticks and
 * are represented by separate `TemplateHead` / `TemplateMiddle` /
 * `TemplateTail` / `TemplateNoSub` kinds.
 */
export interface StringToken extends BaseToken {
    kind: TokenKind.StringLiteral;
    quote: '"' | "'";
}

export interface OtherToken extends BaseToken {
    kind: Exclude<TokenKind, TokenKind.StringLiteral>;
}

export type Token = StringToken | OtherToken;

export interface LexError {
    message: string;
    line: number;
    col: number;
    offset: number;
}

const KEYWORDS = new Map<string, TokenKind>([
    ["workflow", TokenKind.Workflow],
    ["const", TokenKind.Const],
    ["if", TokenKind.If],
    ["else", TokenKind.Else],
    ["switch", TokenKind.Switch],
    ["case", TokenKind.Case],
    ["default", TokenKind.Default],
    ["return", TokenKind.Return],
    ["break", TokenKind.Break],
    ["throw", TokenKind.Throw],
    ["true", TokenKind.BooleanLiteral],
    ["false", TokenKind.BooleanLiteral],
    ["null", TokenKind.NullLiteral],
]);

/**
 * A comment captured by the lexer.
 *
 * `text` stores the FULL lexeme including the leading `//` (line) or
 * `/* ... *​/` (block) delimiters so that an AST-to-source serializer
 * can reproduce the original spelling without ambiguity. This is a
 * superset of the spec's `{ text, pos }` shape; the extra `block` flag
 * makes downstream serializers cheaper.
 */
export interface LexComment {
    /** Full comment text, including `//` or `/* *​/` delimiters. */
    text: string;
    line: number;
    col: number;
    offset: number;
    /** True for `/* *​/`, false for `//`. */
    block: boolean;
}

export function lex(source: string): {
    tokens: Token[];
    errors: LexError[];
    comments: LexComment[];
} {
    const tokens: Token[] = [];
    const errors: LexError[] = [];
    const comments: LexComment[] = [];
    let pos = 0;
    let line = 1;
    let col = 1;

    function peek(): string {
        return pos < source.length ? source[pos] : "";
    }

    function peekAt(offset: number): string {
        const idx = pos + offset;
        return idx < source.length ? source[idx] : "";
    }

    function advance(): string {
        const ch = source[pos++];
        if (ch === "\n") {
            line++;
            col = 1;
        } else {
            col++;
        }
        return ch;
    }

    function token(
        kind: TokenKind,
        value: string,
        startLine: number,
        startCol: number,
        startOffset: number,
    ): Token {
        return {
            kind,
            value,
            line: startLine,
            col: startCol,
            offset: startOffset,
        } as Token;
    }

    /**
     * Translate a raw-slice offset back to source line/col coordinates
     * and push a LexError. `rawStartLine` / `rawStartCol` /
     * `rawStartOffset` describe the source position of `raw[0]`. For
     * string literals (no raw newlines allowed) `raw` is single-line so
     * line stays constant; for template spans `raw` may contain `\n`
     * and we walk it to recover the right line/col. This makes invalid
     * escapes (e.g. `\xZZ`) surface as real lex errors at the offending
     * character, matching JS strict-mode behavior where such literals
     * are SyntaxErrors at parse time.
     */
    function reportDecodeError(
        message: string,
        raw: string,
        offsetInRaw: number,
        rawStartLine: number,
        rawStartCol: number,
        rawStartOffset: number,
    ): void {
        let l = rawStartLine;
        let c = rawStartCol;
        for (let i = 0; i < offsetInRaw && i < raw.length; i++) {
            if (raw[i] === "\n") {
                l++;
                c = 1;
            } else {
                c++;
            }
        }
        errors.push({
            message,
            line: l,
            col: c,
            offset: rawStartOffset + offsetInRaw,
        });
    }

    /**
     * Validate the cooked content of a template span (the slice between
     * a backtick or `}` and the next `${` or backtick). Invalid escape
     * sequences in template literals are SyntaxErrors in untagged JS;
     * the formatter doesn't distinguish tagged vs untagged, so we
     * report them unconditionally.
     */
    function validateTemplateRaw(
        raw: string,
        spanLine: number,
        spanCol: number,
        spanOffset: number,
    ): void {
        const decoded = decodeTemplatePart(raw);
        for (const e of decoded.errors) {
            reportDecodeError(
                e.message,
                raw,
                e.offsetInRaw,
                spanLine,
                spanCol,
                spanOffset,
            );
        }
    }

    /**
     * Consume a `\` escape sequence's payload, leaving the cooked value
     * unchanged on the output side (raw-text scanning). Handles the one
     * special case that matters for raw scanning: a `\` immediately
     * followed by CRLF is a single line-continuation escape and both
     * the `\r` and the `\n` are consumed together. Caller must have
     * already consumed the leading backslash.
     */
    function consumeEscapedCharRaw(): void {
        if (pos >= source.length) return;
        if (source[pos] === "\r") {
            advance();
            if (pos < source.length && source[pos] === "\n") {
                advance();
            }
            return;
        }
        advance();
    }

    // Template literal depth: tracks nested `${}` so that `}` inside a
    // template expression resumes template lexing instead of being treated
    // as a brace.
    let templateDepth = 0;

    /**
     * Lex a template span: the text between the opening backtick (or `}`)
     * and either `${` (emit Head/Middle) or the closing backtick (emit
     * Tail/NoSub).
     *
     * @param isHead - true for the first span after the opening backtick
     */
    function lexTemplateSpan(isHead: boolean): void {
        const spanLine = line;
        const spanCol = col;
        const spanOffset = pos;
        const startOffset = pos;

        while (pos < source.length) {
            if (
                source[pos] === "$" &&
                pos + 1 < source.length &&
                source[pos + 1] === "{"
            ) {
                const raw = source.slice(startOffset, pos);
                validateTemplateRaw(raw, spanLine, spanCol, startOffset);
                // Interpolation start: emit Head or Middle
                advance(); // $
                advance(); // {
                tokens.push(
                    token(
                        isHead
                            ? TokenKind.TemplateHead
                            : TokenKind.TemplateMiddle,
                        raw,
                        spanLine,
                        spanCol,
                        spanOffset,
                    ),
                );
                templateDepth++;
                return;
            }
            if (source[pos] === "`") {
                const raw = source.slice(startOffset, pos);
                validateTemplateRaw(raw, spanLine, spanCol, startOffset);
                advance(); // closing backtick
                tokens.push(
                    token(
                        isHead
                            ? TokenKind.TemplateNoSub
                            : TokenKind.TemplateTail,
                        raw,
                        spanLine,
                        spanCol,
                        spanOffset,
                    ),
                );
                return;
            }
            if (source[pos] === "\\") {
                advance(); // backslash
                consumeEscapedCharRaw();
            } else {
                advance();
            }
        }

        errors.push({
            message: "Unterminated template literal",
            line: spanLine,
            col: spanCol,
            offset: spanOffset,
        });
    }

    while (pos < source.length) {
        const startLine = line;
        const startCol = col;
        const startOffset = pos;
        const ch = peek();

        // Whitespace
        if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
            advance();
            continue;
        }

        // Line comments
        if (ch === "/" && peekAt(1) === "/") {
            const commentStartOffset = pos;
            while (pos < source.length && source[pos] !== "\n") {
                advance();
            }
            comments.push({
                text: source.slice(commentStartOffset, pos),
                line: startLine,
                col: startCol,
                offset: startOffset,
                block: false,
            });
            continue;
        }

        // Block comments
        if (ch === "/" && peekAt(1) === "*") {
            const commentStartOffset = pos;
            advance(); // /
            advance(); // *
            let closed = false;
            while (pos < source.length) {
                if (source[pos] === "*" && peekAt(1) === "/") {
                    advance(); // *
                    advance(); // /
                    closed = true;
                    break;
                }
                advance();
            }
            if (!closed) {
                errors.push({
                    message: "Unterminated block comment",
                    line: startLine,
                    col: startCol,
                    offset: startOffset,
                });
            }
            comments.push({
                text: source.slice(commentStartOffset, pos),
                line: startLine,
                col: startCol,
                offset: startOffset,
                block: true,
            });
            continue;
        }

        // String literals
        if (ch === '"' || ch === "'") {
            const quote = ch;
            advance();
            const innerStart = pos;
            let unterminated = false;
            while (pos < source.length && source[pos] !== quote) {
                const c = source[pos];
                // Raw line terminators are forbidden inside string literals
                // (strict-mode JS semantics). Use `\<newline>` for line
                // continuation, or a template literal for multi-line text.
                if (
                    c === "\n" ||
                    c === "\r" ||
                    c === "\u2028" ||
                    c === "\u2029"
                ) {
                    errors.push({
                        message:
                            "Unterminated string literal (raw newline not allowed)",
                        line: startLine,
                        col: startCol,
                        offset: startOffset,
                    });
                    unterminated = true;
                    break;
                }
                if (c === "\\") {
                    advance(); // backslash
                    consumeEscapedCharRaw();
                } else {
                    advance();
                }
            }
            const raw = source.slice(innerStart, pos);
            if (!unterminated && pos < source.length) {
                advance(); // closing quote
            } else if (!unterminated) {
                errors.push({
                    message: "Unterminated string literal",
                    line: startLine,
                    col: startCol,
                    offset: startOffset,
                });
            }
            // Validate escapes inside the raw slice: invalid sequences
            // (e.g. `\xZZ`, `\u{ABCDEFG}`, `\1`) become lex errors,
            // matching JS strict-mode behavior. Without this check the
            // emitter would silently substitute a default cooked value.
            const decoded = decodeStringLiteral(raw, quote as '"' | "'");
            for (const e of decoded.errors) {
                reportDecodeError(
                    e.message,
                    raw,
                    e.offsetInRaw,
                    startLine,
                    // +1 for the opening quote character
                    startCol + 1,
                    innerStart,
                );
            }
            const tok: StringToken = {
                kind: TokenKind.StringLiteral,
                value: raw,
                line: startLine,
                col: startCol,
                offset: startOffset,
                quote: quote as '"' | "'",
            };
            tokens.push(tok);
            continue;
        }

        // Template literals (backtick strings with ${} interpolation)
        if (ch === "`") {
            advance(); // opening backtick
            lexTemplateSpan(true);
            continue;
        }

        // Numbers
        if (ch >= "0" && ch <= "9") {
            let num = "";
            let hasDot = false;
            while (
                pos < source.length &&
                ((source[pos] >= "0" && source[pos] <= "9") ||
                    (source[pos] === "." && !hasDot))
            ) {
                if (source[pos] === ".") hasDot = true;
                num += advance();
            }
            tokens.push(
                token(
                    TokenKind.NumberLiteral,
                    num,
                    startLine,
                    startCol,
                    startOffset,
                ),
            );
            continue;
        }

        // Identifiers and keywords
        if (
            (ch >= "a" && ch <= "z") ||
            (ch >= "A" && ch <= "Z") ||
            ch === "_"
        ) {
            let id = "";
            while (
                pos < source.length &&
                ((source[pos] >= "a" && source[pos] <= "z") ||
                    (source[pos] >= "A" && source[pos] <= "Z") ||
                    (source[pos] >= "0" && source[pos] <= "9") ||
                    source[pos] === "_")
            ) {
                id += advance();
            }
            const kw = KEYWORDS.get(id);
            tokens.push(
                token(
                    kw ?? TokenKind.Identifier,
                    id,
                    startLine,
                    startCol,
                    startOffset,
                ),
            );
            continue;
        }

        // Multi-character operators and punctuation
        switch (ch) {
            case "(":
                advance();
                tokens.push(
                    token(
                        TokenKind.LParen,
                        "(",
                        startLine,
                        startCol,
                        startOffset,
                    ),
                );
                continue;
            case ")":
                advance();
                tokens.push(
                    token(
                        TokenKind.RParen,
                        ")",
                        startLine,
                        startCol,
                        startOffset,
                    ),
                );
                continue;
            case "{":
                advance();
                tokens.push(
                    token(
                        TokenKind.LBrace,
                        "{",
                        startLine,
                        startCol,
                        startOffset,
                    ),
                );
                continue;
            case "}":
                if (templateDepth > 0) {
                    advance();
                    templateDepth--;
                    lexTemplateSpan(false);
                    continue;
                }
                advance();
                tokens.push(
                    token(
                        TokenKind.RBrace,
                        "}",
                        startLine,
                        startCol,
                        startOffset,
                    ),
                );
                continue;
            case "[":
                advance();
                tokens.push(
                    token(
                        TokenKind.LBracket,
                        "[",
                        startLine,
                        startCol,
                        startOffset,
                    ),
                );
                continue;
            case "]":
                advance();
                tokens.push(
                    token(
                        TokenKind.RBracket,
                        "]",
                        startLine,
                        startCol,
                        startOffset,
                    ),
                );
                continue;
            case ":":
                advance();
                tokens.push(
                    token(
                        TokenKind.Colon,
                        ":",
                        startLine,
                        startCol,
                        startOffset,
                    ),
                );
                continue;
            case ",":
                advance();
                tokens.push(
                    token(
                        TokenKind.Comma,
                        ",",
                        startLine,
                        startCol,
                        startOffset,
                    ),
                );
                continue;
            case ".":
                advance();
                tokens.push(
                    token(TokenKind.Dot, ".", startLine, startCol, startOffset),
                );
                continue;
            case ";":
                advance();
                tokens.push(
                    token(
                        TokenKind.Semicolon,
                        ";",
                        startLine,
                        startCol,
                        startOffset,
                    ),
                );
                continue;
            case "?":
                advance();
                tokens.push(
                    token(
                        TokenKind.QuestionMark,
                        "?",
                        startLine,
                        startCol,
                        startOffset,
                    ),
                );
                continue;
            case "=":
                advance();
                if (peek() === "=") {
                    advance();
                    if (peek() === "=") {
                        advance();
                        tokens.push(
                            token(
                                TokenKind.TripleEquals,
                                "===",
                                startLine,
                                startCol,
                                startOffset,
                            ),
                        );
                    } else {
                        errors.push({
                            message:
                                "Use === instead of == (no implicit coercion)",
                            line: startLine,
                            col: startCol,
                            offset: startOffset,
                        });
                    }
                } else if (peek() === ">") {
                    advance();
                    tokens.push(
                        token(
                            TokenKind.Arrow,
                            "=>",
                            startLine,
                            startCol,
                            startOffset,
                        ),
                    );
                } else {
                    tokens.push(
                        token(
                            TokenKind.Equals,
                            "=",
                            startLine,
                            startCol,
                            startOffset,
                        ),
                    );
                }
                continue;
            case "!":
                advance();
                if (peek() === "=") {
                    advance();
                    if (peek() === "=") {
                        advance();
                        tokens.push(
                            token(
                                TokenKind.NotTripleEquals,
                                "!==",
                                startLine,
                                startCol,
                                startOffset,
                            ),
                        );
                    } else {
                        errors.push({
                            message:
                                "Use !== instead of != (no implicit coercion)",
                            line: startLine,
                            col: startCol,
                            offset: startOffset,
                        });
                    }
                } else {
                    tokens.push(
                        token(
                            TokenKind.Not,
                            "!",
                            startLine,
                            startCol,
                            startOffset,
                        ),
                    );
                }
                continue;
            case ">":
                advance();
                if (peek() === "=") {
                    advance();
                    tokens.push(
                        token(
                            TokenKind.GreaterOrEqual,
                            ">=",
                            startLine,
                            startCol,
                            startOffset,
                        ),
                    );
                } else {
                    tokens.push(
                        token(
                            TokenKind.GreaterThan,
                            ">",
                            startLine,
                            startCol,
                            startOffset,
                        ),
                    );
                }
                continue;
            case "<":
                advance();
                if (peek() === "=") {
                    advance();
                    tokens.push(
                        token(
                            TokenKind.LessOrEqual,
                            "<=",
                            startLine,
                            startCol,
                            startOffset,
                        ),
                    );
                } else {
                    tokens.push(
                        token(
                            TokenKind.LessThan,
                            "<",
                            startLine,
                            startCol,
                            startOffset,
                        ),
                    );
                }
                continue;
            case "&":
                advance();
                if (peek() === "&") {
                    advance();
                    tokens.push(
                        token(
                            TokenKind.And,
                            "&&",
                            startLine,
                            startCol,
                            startOffset,
                        ),
                    );
                } else {
                    errors.push({
                        message: "Unexpected character: &. Did you mean &&?",
                        line: startLine,
                        col: startCol,
                        offset: startOffset,
                    });
                }
                continue;
            case "|":
                advance();
                if (peek() === "|") {
                    advance();
                    tokens.push(
                        token(
                            TokenKind.Or,
                            "||",
                            startLine,
                            startCol,
                            startOffset,
                        ),
                    );
                } else {
                    errors.push({
                        message: "Unexpected character: |. Did you mean ||?",
                        line: startLine,
                        col: startCol,
                        offset: startOffset,
                    });
                }
                continue;
            case "+":
                advance();
                tokens.push(
                    token(
                        TokenKind.Plus,
                        "+",
                        startLine,
                        startCol,
                        startOffset,
                    ),
                );
                continue;
            case "-":
                // Negative number: only when preceded by = , [ ( : or an operator
                if (peekAt(1) >= "0" && peekAt(1) <= "9") {
                    const prevToken =
                        tokens.length > 0
                            ? tokens[tokens.length - 1]
                            : undefined;
                    if (
                        !prevToken ||
                        prevToken.kind === TokenKind.Equals ||
                        prevToken.kind === TokenKind.Comma ||
                        prevToken.kind === TokenKind.LBracket ||
                        prevToken.kind === TokenKind.LParen ||
                        prevToken.kind === TokenKind.Colon ||
                        prevToken.kind === TokenKind.Arrow
                    ) {
                        let num = "";
                        num += advance(); // -
                        while (
                            pos < source.length &&
                            ((source[pos] >= "0" && source[pos] <= "9") ||
                                source[pos] === ".")
                        ) {
                            num += advance();
                        }
                        tokens.push(
                            token(
                                TokenKind.NumberLiteral,
                                num,
                                startLine,
                                startCol,
                                startOffset,
                            ),
                        );
                        continue;
                    }
                }
                advance();
                tokens.push(
                    token(
                        TokenKind.Minus,
                        "-",
                        startLine,
                        startCol,
                        startOffset,
                    ),
                );
                continue;
            case "*":
                advance();
                tokens.push(
                    token(
                        TokenKind.Star,
                        "*",
                        startLine,
                        startCol,
                        startOffset,
                    ),
                );
                continue;
            case "/":
                // Comments already handled above, this is division
                advance();
                tokens.push(
                    token(
                        TokenKind.Slash,
                        "/",
                        startLine,
                        startCol,
                        startOffset,
                    ),
                );
                continue;
            case "%":
                advance();
                tokens.push(
                    token(
                        TokenKind.Percent,
                        "%",
                        startLine,
                        startCol,
                        startOffset,
                    ),
                );
                continue;
        }

        // Unknown character
        errors.push({
            message: `Unexpected character: ${ch}`,
            line: startLine,
            col: startCol,
            offset: startOffset,
        });
        advance();
    }

    tokens.push(token(TokenKind.EOF, "", line, col, pos));
    return { tokens, errors, comments };
}
