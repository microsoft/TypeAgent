// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Invisible Unicode character scanner.
 *
 * Detects Unicode characters that are invisible to human reviewers but can
 * be used to hide malicious code in source files. This covers two known
 * attack classes:
 *
 *  - Trojan Source (CVE-2021-42574): Bidirectional control characters that
 *    cause editors/diff tools to display code in a different order than it
 *    is actually parsed and executed by the compiler/interpreter.
 *
 *  - GlassWorm / steganographic payloads: Zero-width and invisible Unicode
 *    characters used to encode hidden instructions inside ordinary-looking
 *    source files. The hidden payload is extracted at runtime by a small
 *    decoder that is itself concealed using the same technique.
 *
 * References:
 *   https://trojansource.codes/ (CVE-2021-42574)
 *   https://www.scientificamerican.com/article/glassworm-malware-hides-in-invisible-open-source-code/
 */

// Bidirectional control characters — can reorder what editors display vs
// what compilers see, allowing an attacker to make malicious code look like
// an innocent comment or string literal.
const BIDI_CHARS = [
    { code: 0x200e, name: "LEFT-TO-RIGHT MARK (LRM)" },
    { code: 0x200f, name: "RIGHT-TO-LEFT MARK (RLM)" },
    { code: 0x202a, name: "LEFT-TO-RIGHT EMBEDDING (LRE)" },
    { code: 0x202b, name: "RIGHT-TO-LEFT EMBEDDING (RLE)" },
    { code: 0x202c, name: "POP DIRECTIONAL FORMATTING (PDF)" },
    { code: 0x202d, name: "LEFT-TO-RIGHT OVERRIDE (LRO)" },
    { code: 0x202e, name: "RIGHT-TO-LEFT OVERRIDE (RLO)" },
    { code: 0x2066, name: "LEFT-TO-RIGHT ISOLATE (LRI)" },
    { code: 0x2067, name: "RIGHT-TO-LEFT ISOLATE (RLI)" },
    { code: 0x2068, name: "FIRST STRONG ISOLATE (FSI)" },
    { code: 0x2069, name: "POP DIRECTIONAL ISOLATE (PDI)" },
];

// Zero-width and invisible characters — can encode steganographic payloads
// that are completely invisible in editors, code review tools, and diffs.
const ZERO_WIDTH_CHARS = [
    { code: 0x200b, name: "ZERO WIDTH SPACE (ZWSP)" },
    { code: 0x200c, name: "ZERO WIDTH NON-JOINER (ZWNJ)" },
    { code: 0x200d, name: "ZERO WIDTH JOINER (ZWJ)" },
    { code: 0x2060, name: "WORD JOINER" },
    { code: 0x2061, name: "FUNCTION APPLICATION" },
    { code: 0x2062, name: "INVISIBLE TIMES" },
    { code: 0x2063, name: "INVISIBLE SEPARATOR" },
    { code: 0x2064, name: "INVISIBLE PLUS" },
    // U+FEFF is the UTF-8 BOM when it appears at byte offset 0 of a file, but
    // is otherwise a zero-width no-break space that has no visible form.
    { code: 0xfeff, name: "ZERO WIDTH NO-BREAK SPACE / BOM (ZWNBSP)" },
];

const ALL_SUSPICIOUS = [...BIDI_CHARS, ...ZERO_WIDTH_CHARS];

// Build a single regex that matches any of the suspicious characters.
const SUSPICIOUS_PATTERN = ALL_SUSPICIOUS.map((c) =>
    String.fromCodePoint(c.code),
).join("");
const SUSPICIOUS_REGEX = new RegExp(`[${SUSPICIOUS_PATTERN}]`, "g");

// Map from character → descriptor for fast lookup when reporting.
const CHAR_INFO = new Map(
    ALL_SUSPICIOUS.map((c) => [String.fromCodePoint(c.code), c]),
);

/**
 * Scan a Repofile for invisible Unicode characters.
 *
 * Returns true if clean, or an array of human-readable error strings if any
 * suspicious characters are found.
 */
function checkInvisibleUnicode(file) {
    const content = file.content;
    const lines = content.split("\n");
    const errors = [];

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        // Reset lastIndex for each line by creating a fresh exec loop.
        const re = new RegExp(SUSPICIOUS_REGEX.source, "g");
        let match;
        while ((match = re.exec(line)) !== null) {
            const info = CHAR_INFO.get(match[0]);
            // U+FEFF is the UTF-8 BOM marker: tolerate it only at the very
            // first character of the file (line 0, column 0).
            if (info.code === 0xfeff && lineIdx === 0 && match.index === 0) {
                continue;
            }
            // U+200D ZERO WIDTH JOINER is legitimately used inside emoji
            // sequences (e.g., 👨‍💻 = 👨 + ZWJ + 💻). Non-BMP emoji are
            // encoded as surrogate pairs in JavaScript strings, so if the
            // character immediately before the ZWJ is a low surrogate
            // (U+DC00–U+DFFF) we can be confident this is an emoji sequence
            // rather than an attempt to hide content.
            if (info.code === 0x200d && match.index > 0) {
                const prevCode = line.charCodeAt(match.index - 1);
                if (prevCode >= 0xdc00 && prevCode <= 0xdfff) {
                    continue;
                }
            }
            const hex = info.code.toString(16).toUpperCase().padStart(4, "0");
            errors.push(
                `Line ${lineIdx + 1}, col ${match.index + 1}: ` +
                    `Invisible Unicode U+${hex} ${info.name}`,
            );
        }
    }

    return errors.length === 0 ? true : errors;
}

// Apply the check to all common source-code file types.
const SOURCE_FILE_PATTERN =
    /.*\.[cm]?[jt]sx?$|.*\.py$|.*\.cs$|.*\.ya?ml$|.*\.json$|.*\.html?$|.*\.(sh|cmd|bat|ps1)$/i;

export const rules = [
    {
        name: "invisible-unicode",
        match: SOURCE_FILE_PATTERN,
        check: (file) => checkInvisibleUnicode(file),
    },
];
