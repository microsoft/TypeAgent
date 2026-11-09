// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tiny syntax highlighters shared by the chat renderers.
 *
 * Both return HTML with <span class="json-*"> wrappers and escape `<`,
 * `>` and `&` on every character that passes through. The renderer also
 * sanitizes this markup into a DOM fragment before insertion. The token
 * class names are shared so one set of CSS rules colors both languages.
 */
// Lightweight JSON syntax highlighter — returns HTML with span wrappers
// around tokens. Implemented as a hand-rolled scanner rather than a
// single tokenizing regex so we have no chance of polynomial backtracking
// on adversarial input (the JSON comes from action data which can carry
// arbitrary user content). Also escapes <, >, & in any character that
// passes through.
// Avoids pulling in highlight.js / Prism just to colorize the action
// JSON popup.
// code-complexity-allow: hand-rolled JSON scanner kept branchy to avoid regex backtracking
export function highlightJson(json: string): string {
    const escapeChar = (c: string): string =>
        c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c;
    const wrap = (cls: string, text: string): string =>
        `<span class="${cls}">${text}</span>`;

    let out = "";
    let i = 0;
    const n = json.length;
    while (i < n) {
        const ch = json[i];
        if (ch === '"') {
            // Linear scan to the matching closing quote, honoring `\\`
            // and `\"` escapes. Each character is consumed at most once,
            // so this is O(n) worst case.
            let j = i + 1;
            let raw = '"';
            while (j < n) {
                const cj = json[j];
                if (cj === "\\" && j + 1 < n) {
                    raw += "\\" + escapeChar(json[j + 1]);
                    j += 2;
                    continue;
                }
                raw += escapeChar(cj);
                j++;
                if (cj === '"') break;
            }
            i = j;
            // If a colon follows (optionally with whitespace), this is a
            // JSON object key; otherwise a string value.
            let k = i;
            while (k < n && (json[k] === " " || json[k] === "\t")) k++;
            if (json[k] === ":") {
                out += wrap("json-key", raw + json.slice(i, k + 1));
                i = k + 1;
            } else {
                out += wrap("json-string", raw);
            }
        } else if (
            (ch >= "0" && ch <= "9") ||
            (ch === "-" &&
                i + 1 < n &&
                json[i + 1] >= "0" &&
                json[i + 1] <= "9")
        ) {
            let j = i + 1;
            while (
                j < n &&
                ((json[j] >= "0" && json[j] <= "9") ||
                    json[j] === "." ||
                    json[j] === "e" ||
                    json[j] === "E" ||
                    json[j] === "+" ||
                    json[j] === "-")
            ) {
                j++;
            }
            out += wrap("json-number", json.slice(i, j));
            i = j;
        } else if (json.startsWith("true", i)) {
            out += wrap("json-bool", "true");
            i += 4;
        } else if (json.startsWith("false", i)) {
            out += wrap("json-bool", "false");
            i += 5;
        } else if (json.startsWith("null", i)) {
            out += wrap("json-null", "null");
            i += 4;
        } else {
            out += escapeChar(ch);
            i++;
        }
    }
    return out;
}

// Lightweight YAML highlighter for the config snippets agents hand the
// user. Line-oriented and deliberately minimal — these snippets are
// `key: value` pairs and comments, not the full YAML grammar — and it
// reuses the JSON token classes so one set of CSS colors both.
//
// Like highlightJson, it escapes every character it passes through.
export function highlightYaml(yaml: string): string {
    const esc = (s: string): string =>
        s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const wrap = (cls: string, text: string): string =>
        `<span class="${cls}">${esc(text)}</span>`;

    return yaml
        .split("\n")
        .map((line) => {
            const trimmed = line.trim();
            if (trimmed === "") {
                return esc(line);
            }
            if (trimmed.startsWith("#")) {
                return wrap("json-null", line);
            }
            // Split on the first ": " (or a trailing ":"), which is the
            // key/value boundary for the flat mappings we emit.
            const m = /^(\s*-?\s*)([^:]+)(:)(\s*)(.*)$/.exec(line);
            if (m === null) {
                return esc(line);
            }
            const [, indent, key, colon, space, rest] = m;
            const value =
                rest === ""
                    ? ""
                    : /^-?\d+(\.\d+)?$/.test(rest)
                      ? wrap("json-number", rest)
                      : rest === "true" || rest === "false"
                        ? wrap("json-bool", rest)
                        : wrap("json-string", rest);
            return (
                esc(indent) + wrap("json-key", key + colon) + esc(space) + value
            );
        })
        .join("\n");
}
