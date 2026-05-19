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
 * Errors (decoder still returns a best-effort `value` for resiliency):
 *
 *   - Trailing backslash with no following character.
 *   - `\1`-`\9` (LegacyOctalEscapeSequence forbidden in strict mode).
 *   - `\0` followed by a decimal digit (would be LegacyOctal).
 *   - `\x` not followed by exactly two hex digits.
 *   - `\u` not followed by `HHHH` or `{H..H}` (well-formed and in
 *      range).
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
                // Recovery: skip past the \x and resume.
                i += 2;
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
