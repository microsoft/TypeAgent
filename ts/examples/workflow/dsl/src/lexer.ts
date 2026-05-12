// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Workflow DSL token types and lexer.
 *
 * The DSL is a TypeScript-like language that compiles to workflow IR JSON.
 * Tokens are position-tracked for source-map generation.
 */

export enum TokenKind {
    // Keywords
    Workflow = "workflow",
    Let = "let",
    For = "for",
    Of = "of",
    If = "if",
    Else = "else",
    Match = "match",
    Return = "return",
    Break = "break",
    Continue = "continue",

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

    // Statement terminator
    Semicolon = ";",

    // Type annotations
    QuestionMark = "?",

    // End
    EOF = "EOF",
}

export interface Token {
    kind: TokenKind;
    value: string;
    line: number;
    col: number;
    offset: number;
}

export interface LexError {
    message: string;
    line: number;
    col: number;
    offset: number;
}

const KEYWORDS = new Map<string, TokenKind>([
    ["workflow", TokenKind.Workflow],
    ["let", TokenKind.Let],
    ["for", TokenKind.For],
    ["of", TokenKind.Of],
    ["if", TokenKind.If],
    ["else", TokenKind.Else],
    ["match", TokenKind.Match],
    ["return", TokenKind.Return],
    ["break", TokenKind.Break],
    ["continue", TokenKind.Continue],
    ["true", TokenKind.BooleanLiteral],
    ["false", TokenKind.BooleanLiteral],
    ["null", TokenKind.NullLiteral],
]);

export function lex(source: string): { tokens: Token[]; errors: LexError[] } {
    const tokens: Token[] = [];
    const errors: LexError[] = [];
    let pos = 0;
    let line = 1;
    let col = 1;

    function peek(): string {
        return pos < source.length ? source[pos] : "";
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
        };
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
        let str = "";

        while (pos < source.length) {
            if (
                source[pos] === "$" &&
                pos + 1 < source.length &&
                source[pos + 1] === "{"
            ) {
                // Interpolation start: emit Head or Middle
                advance(); // $
                advance(); // {
                tokens.push(
                    token(
                        isHead
                            ? TokenKind.TemplateHead
                            : TokenKind.TemplateMiddle,
                        str,
                        spanLine,
                        spanCol,
                        spanOffset,
                    ),
                );
                templateDepth++;
                return;
            }
            if (source[pos] === "`") {
                // End of template: emit Tail or NoSub
                advance(); // closing backtick
                tokens.push(
                    token(
                        isHead
                            ? TokenKind.TemplateNoSub
                            : TokenKind.TemplateTail,
                        str,
                        spanLine,
                        spanCol,
                        spanOffset,
                    ),
                );
                return;
            }
            if (source[pos] === "\\") {
                advance(); // backslash
                const esc = advance();
                switch (esc) {
                    case "n":
                        str += "\n";
                        break;
                    case "t":
                        str += "\t";
                        break;
                    case "r":
                        str += "\r";
                        break;
                    case "\\":
                        str += "\\";
                        break;
                    case "`":
                        str += "`";
                        break;
                    case "$":
                        str += "$";
                        break;
                    default:
                        str += esc;
                        break;
                }
            } else {
                str += advance();
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
        if (ch === "/" && pos + 1 < source.length && source[pos + 1] === "/") {
            while (pos < source.length && source[pos] !== "\n") {
                advance();
            }
            continue;
        }

        // Block comments
        if (ch === "/" && pos + 1 < source.length && source[pos + 1] === "*") {
            advance(); // /
            advance(); // *
            while (pos < source.length) {
                if (
                    source[pos] === "*" &&
                    pos + 1 < source.length &&
                    source[pos + 1] === "/"
                ) {
                    advance(); // *
                    advance(); // /
                    break;
                }
                advance();
            }
            continue;
        }

        // String literals
        if (ch === '"' || ch === "'") {
            const quote = ch;
            advance();
            let str = "";
            while (pos < source.length && source[pos] !== quote) {
                if (source[pos] === "\\") {
                    advance();
                    const esc = advance();
                    switch (esc) {
                        case "n":
                            str += "\n";
                            break;
                        case "t":
                            str += "\t";
                            break;
                        case "r":
                            str += "\r";
                            break;
                        case "\\":
                            str += "\\";
                            break;
                        case "'":
                            str += "'";
                            break;
                        case '"':
                            str += '"';
                            break;
                        default:
                            str += esc;
                            break;
                    }
                } else {
                    str += advance();
                }
            }
            if (pos < source.length) {
                advance(); // closing quote
            } else {
                errors.push({
                    message: "Unterminated string literal",
                    line: startLine,
                    col: startCol,
                    offset: startOffset,
                });
            }
            tokens.push(
                token(
                    TokenKind.StringLiteral,
                    str,
                    startLine,
                    startCol,
                    startOffset,
                ),
            );
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

        // Negative numbers (only when preceded by = or , or [ or ( or :)
        if (
            ch === "-" &&
            pos + 1 < source.length &&
            source[pos + 1] >= "0" &&
            source[pos + 1] <= "9"
        ) {
            const prevToken =
                tokens.length > 0 ? tokens[tokens.length - 1] : undefined;
            if (
                !prevToken ||
                prevToken.kind === TokenKind.Equals ||
                prevToken.kind === TokenKind.Comma ||
                prevToken.kind === TokenKind.LBracket ||
                prevToken.kind === TokenKind.LParen ||
                prevToken.kind === TokenKind.Colon
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

        // Punctuation
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
                    // Closing a template interpolation; resume template lexing
                    advance(); // consume }
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
                if (peek() === ">") {
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
    return { tokens, errors };
}
