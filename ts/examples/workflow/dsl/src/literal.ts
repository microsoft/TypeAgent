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
 * Decoding rules (same shape as the previous in-lexer decode):
 *
 *   \n        -> newline (U+000A)
 *   \t        -> tab     (U+0009)
 *   \r        -> CR      (U+000D)
 *   \\        -> backslash
 *   \"        -> double-quote   (only when the literal is double-quoted)
 *   \'        -> single-quote   (only when the literal is single-quoted)
 *   \`        -> backtick       (templates only)
 *   \<other>  -> <other>        (lenient: unknown escapes pass through)
 *
 * For templates the delimiter set also includes `$`, so `\${` is
 * preserved as a literal `${` in the cooked value without triggering
 * interpolation. Backslash followed by EOF is reported as an error
 * (the lone backslash is still emitted to keep decoding lenient).
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
    if (quote === "`") {
        return decodeTemplatePart(raw);
    }
    return decodeEscapes(raw, new Set([quote]), false);
}

/**
 * Decode a single template-literal part (the text between backticks /
 * interpolation boundaries). Always uses backtick rules: `` \` `` and
 * `\${` decode to their literal characters; `$` not followed by `{` is
 * passed through.
 */
export function decodeTemplatePart(raw: string): DecodeResult {
    return decodeEscapes(raw, new Set(["`"]), true);
}

function decodeEscapes(
    raw: string,
    extraDelimiters: Set<string>,
    isTemplate: boolean,
): DecodeResult {
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
        // Backslash: consume escape sequence
        if (i + 1 >= raw.length) {
            errors.push({
                message: "Trailing backslash with no escape character",
                offsetInRaw: i,
            });
            // Pass the lone backslash through and stop.
            out += "\\";
            i++;
            break;
        }
        const esc = raw[i + 1];
        switch (esc) {
            case "n":
                out += "\n";
                break;
            case "t":
                out += "\t";
                break;
            case "r":
                out += "\r";
                break;
            case "\\":
                out += "\\";
                break;
            default:
                if (extraDelimiters.has(esc)) {
                    out += esc;
                } else if (isTemplate && esc === "$") {
                    out += "$";
                } else {
                    // Lenient: unknown escapes pass through as the literal
                    // character. Matches the pre-existing lexer behavior.
                    out += esc;
                }
                break;
        }
        i += 2;
    }
    return { value: out, errors };
}
