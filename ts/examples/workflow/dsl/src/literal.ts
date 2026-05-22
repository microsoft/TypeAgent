// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Literal decoder.
 *
 * The lexer captures string and template literal contents as raw source
 * slices (no escape processing). Consumers that need the semantic
 * (cooked) value call these helpers on demand. The formatter does not
 * decode at all - it re-emits the raw slice verbatim - which is what
 * gives `wff` its round-trip property.
 *
 * Semantics follow ECMA-262 string / template literal escape rules in
 * strict mode (no legacy octal escapes; invalid escapes are errors).
 *
 * Single-character escapes (SingleEscapeCharacter):
 *
 *   \'  ->  U+0027  (single-quote)    // string literals only
 *   \"  ->  U+0022  (double-quote)    // string literals only
 *   \\  ->  U+005C  (backslash)
 *   \b  ->  U+0008  (backspace)
 *   \f  ->  U+000C  (form feed)
 *   \n  ->  U+000A  (line feed)
 *   \r  ->  U+000D  (carriage return)
 *   \t  ->  U+0009  (character tabulation)
 *   \v  ->  U+000B  (line tabulation)
 *
 * Hex / unicode escapes:
 *
 *   \xHH         ->  U+00HH (exactly 2 hex digits required)
 *   \uHHHH       ->  U+HHHH (exactly 4 hex digits required)
 *   \u{H..H}     ->  codepoint (1-6 hex digits, value <= 0x10FFFF)
 *
 * Other forms:
 *
 *   \0       ->  U+0000   (NUL; only when NOT followed by a decimal
 *                         digit, mirroring strict-mode JS)
 *   \<LT>    ->  empty    (line continuation; LT is LF, CR, CRLF, LS,
 *                         or PS - the LT is consumed and produces no
 *                         output character)
 *   \<other> ->  <other>  (NonEscapeCharacter: any source character
 *                         other than EscapeCharacter or LineTerminator,
 *                         e.g. \q -> q. Strict mode permits this.)
 *
 * Template-only escapes (`quote === "`"`):
 *
 *   \`       ->  U+0060  (backtick)
 *   \${      ->  literal `${` (suppresses interpolation in the cooked
 *                         value; the lexer has already split the source
 *                         on real `${...}` so the `$` and `{` are
 *                         re-emitted as plain characters here)
 *
 * Errors (decoder still returns a best-effort `value` so callers that
 * invoke the helpers directly can keep going; the lexer promotes any
 * of these to a hard `LexError` before they reach the parser):
 *
 *   - Trailing backslash with no following character.
 *   - `\1`-`\9` (LegacyOctalEscapeSequence forbidden in strict mode).
 *   - `\0` followed by a decimal digit (would be LegacyOctal).
 *   - `\x` not followed by exactly two hex digits.
 *   - `\u` not followed by `HHHH` or `{H..H}` (well-formed and in
 *      range).
 *
 * Note on error recovery: ECMA-262 treats all of the above as fatal
 * SyntaxErrors at parse time and aborts. This decoder deliberately
 * differs: it reports the error and continues decoding so that ad-hoc
 * callers (tests, REPL-style tools) can still obtain a best-effort
 * cooked value from a partially broken raw slice.
 *
 * The standard DSL pipeline does NOT rely on that leniency: `lex()`
 * runs the decoder eagerly on every string / template raw slice and
 * promotes any `DecodeError` to a `LexError`, so by the time the
 * parser / emitter see a token its raw is guaranteed to decode
 * cleanly. As a result, the only callers that ever observe a non-
 * empty `errors` array are the ones invoking these helpers directly
 * on hand-built raw text.
 */

export type StringQuote = '"' | "'" | "`";

export interface DecodeError {
    message: string;
    /** Byte offset within the raw string (0-based). */
    offsetInRaw: number;
}

export interface DecodeResult {
    value: string;
    errors: DecodeError[];
}

/**
 * Decode a string-literal raw slice (the text between the matching
 * delimiters, exclusive). `quote` is the original delimiter character;
 * its corresponding `\\<quote>` escape decodes to the literal delimiter.
 */
export function decodeStringLiteral(
    raw: string,
    quote: StringQuote,
): DecodeResult {
    return decodeEscapes(raw, quote === "`");
}

/**
 * Decode a single template-literal part (the text between backticks /
 * interpolation boundaries). Always uses backtick rules: `` \` `` and
 * `\${` decode to their literal characters; `$` not followed by `{` is
 * passed through.
 */
export function decodeTemplatePart(raw: string): DecodeResult {
    return decodeEscapes(raw, true);
}

function decodeEscapes(raw: string, isTemplate: boolean): DecodeResult {
    const errors: DecodeError[] = [];
    let out = "";
    let i = 0;
    while (i < raw.length) {
        const c = raw[i];
        if (c !== "\\") {
            out += c;
            i++;
            continue;
        }
        // Backslash: consume escape sequence.
        const escStart = i;
        if (i + 1 >= raw.length) {
            errors.push({
                message: "Trailing backslash with no escape character",
                offsetInRaw: i,
            });
            // Pass the lone backslash through and stop.
            out += "\\";
            break;
        }
        const esc = raw[i + 1];
        switch (esc) {
            // SingleEscapeCharacter (subset that is always the same code point)
            case "b":
                out += "\b";
                i += 2;
                continue;
            case "f":
                out += "\f";
                i += 2;
                continue;
            case "n":
                out += "\n";
                i += 2;
                continue;
            case "r":
                out += "\r";
                i += 2;
                continue;
            case "t":
                out += "\t";
                i += 2;
                continue;
            case "v":
                out += "\v";
                i += 2;
                continue;
            case "\\":
                out += "\\";
                i += 2;
                continue;
            case '"':
            case "'":
            case "`":
                out += esc;
                i += 2;
                continue;
        }
        // \${ in templates suppresses interpolation in the cooked value.
        if (isTemplate && esc === "$") {
            out += "$";
            i += 2;
            continue;
        }
        // \0 -> NUL when not followed by a decimal digit. \0<digit> would
        // be a LegacyOctalEscapeSequence and is forbidden in strict mode.
        if (esc === "0") {
            const next = raw[i + 2];
            if (next !== undefined && next >= "0" && next <= "9") {
                errors.push({
                    message: `Octal escape sequences are not allowed (\\0 followed by digit '${next}')`,
                    offsetInRaw: escStart,
                });
                // Recovery: emit NUL and continue past the lone \0.
                out += "\0";
                i += 2;
                continue;
            }
            out += "\0";
            i += 2;
            continue;
        }
        // \1-\9 -> LegacyOctalEscapeSequence / NonOctalDecimalEscapeSequence,
        // forbidden in strict mode.
        if (esc >= "1" && esc <= "9") {
            errors.push({
                message: `Octal escape sequences are not allowed ('\\${esc}')`,
                offsetInRaw: escStart,
            });
            // Recovery: emit the digit so downstream consumers see something.
            out += esc;
            i += 2;
            continue;
        }
        // \xHH
        if (esc === "x") {
            const h1 = raw[i + 2];
            const h2 = raw[i + 3];
            if (!isHex(h1) || !isHex(h2)) {
                errors.push({
                    message:
                        "Invalid hex escape: expected '\\xHH' with two hex digits",
                    offsetInRaw: escStart,
                });
                // JS spec recovery (NotEscapeSequence for `\x`):
                //   x [lookahead ∉ HexDigit]                -> consume `\x`
                //   x HexDigit [lookahead ∉ HexDigit]       -> consume `\xH`
                // The bad escape's cooked value is undefined per spec;
                // we elide it (emit nothing). Consuming the partially-
                // matched hex digit prevents it from being re-scanned
                // as ordinary text (or, worse, as the start of another
                // escape if it happened to be `\`).
                i += isHex(h1) ? 3 : 2;
                continue;
            }
            out += String.fromCharCode(parseInt(h1 + h2, 16));
            i += 4;
            continue;
        }
        // \uHHHH or \u{H..H}
        if (esc === "u") {
            if (raw[i + 2] === "{") {
                // \u{H..H}
                let j = i + 3;
                let hex = "";
                while (j < raw.length && isHex(raw[j]) && hex.length < 6) {
                    hex += raw[j];
                    j++;
                }
                if (hex.length === 0 || raw[j] !== "}") {
                    errors.push({
                        message:
                            "Invalid unicode escape: expected '\\u{H..H}' (1-6 hex digits, closed by '}')",
                        offsetInRaw: escStart,
                    });
                    i += 2;
                    continue;
                }
                const cp = parseInt(hex, 16);
                if (cp > 0x10ffff) {
                    errors.push({
                        message: `Unicode code point out of range: U+${hex.toUpperCase()} > U+10FFFF`,
                        offsetInRaw: escStart,
                    });
                    i = j + 1;
                    continue;
                }
                out += String.fromCodePoint(cp);
                i = j + 1;
                continue;
            }
            // \uHHHH
            const h1 = raw[i + 2];
            const h2 = raw[i + 3];
            const h3 = raw[i + 4];
            const h4 = raw[i + 5];
            if (!isHex(h1) || !isHex(h2) || !isHex(h3) || !isHex(h4)) {
                errors.push({
                    message:
                        "Invalid unicode escape: expected '\\uHHHH' or '\\u{H..H}'",
                    offsetInRaw: escStart,
                });
                i += 2;
                continue;
            }
            out += String.fromCharCode(parseInt(h1 + h2 + h3 + h4, 16));
            i += 6;
            continue;
        }
        // Line continuation: \<LineTerminator> consumes the LT and emits
        // nothing. CRLF is treated as a single LineTerminatorSequence.
        if (esc === "\n" || esc === "\u2028" || esc === "\u2029") {
            i += 2;
            continue;
        }
        if (esc === "\r") {
            i += raw[i + 2] === "\n" ? 3 : 2;
            continue;
        }
        // NonEscapeCharacter: any source character that is not an
        // EscapeCharacter or LineTerminator. Strict mode permits this
        // and the cooked value is just the character itself.
        out += esc;
        i += 2;
    }
    return { value: out, errors };
}

function isHex(ch: string | undefined): boolean {
    if (ch === undefined) return false;
    return (
        (ch >= "0" && ch <= "9") ||
        (ch >= "a" && ch <= "f") ||
        (ch >= "A" && ch <= "F")
    );
}

// ---- Encoding ---------------------------------------------------------

/**
 * Encode an arbitrary JavaScript string as a DSL string-literal body
 * (the text that would sit between the surrounding `quote` delimiters,
 * exclusive). The result, when wrapped in `quote`, parses back to the
 * original value via `decodeStringLiteral`.
 *
 * Escapes the matching delimiter, `\`, and the standard
 * SingleEscapeCharacter set (`\b`, `\f`, `\n`, `\r`, `\t`, `\v`).
 * Other control characters (U+0000..U+001F, U+007F) are emitted as
 * `\xHH`. Non-control characters are passed through verbatim, so
 * arbitrary Unicode round-trips without surrogate juggling.
 *
 * For backtick quotes additionally escapes `\` and the `${` digraph
 * so the result cannot accidentally introduce an interpolation.
 */
export function encodeStringLiteral(value: string, quote: StringQuote): string {
    let out = "";
    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        const code = value.charCodeAt(i);
        if (ch === "\\") {
            out += "\\\\";
            continue;
        }
        if (ch === quote) {
            out += "\\" + quote;
            continue;
        }
        // Suppress `${` interpolation introduction inside backtick strings.
        if (quote === "`" && ch === "$" && value[i + 1] === "{") {
            out += "\\$";
            continue;
        }
        switch (ch) {
            case "\b":
                out += "\\b";
                continue;
            case "\f":
                out += "\\f";
                continue;
            case "\n":
                out += "\\n";
                continue;
            case "\r":
                out += "\\r";
                continue;
            case "\t":
                out += "\\t";
                continue;
            case "\v":
                out += "\\v";
                continue;
        }
        if (code < 0x20 || code === 0x7f) {
            out += "\\x" + code.toString(16).padStart(2, "0").toUpperCase();
            continue;
        }
        out += ch;
    }
    return out;
}

/**
 * Encode a value as a complete DSL string literal, including the
 * surrounding delimiters. Equivalent to
 * `quote + encodeStringLiteral(value, quote) + quote`.
 */
export function quoteStringLiteral(
    value: string,
    quote: StringQuote = '"',
): string {
    return quote + encodeStringLiteral(value, quote) + quote;
}
