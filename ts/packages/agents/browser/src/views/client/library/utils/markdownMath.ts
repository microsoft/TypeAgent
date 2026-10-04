// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import { escapeHtml } from "./codeHighlight";

// Math is emitted as inert placeholders whose text is the TeX source. They
// pass through the HTML sanitizer untouched and are typeset afterwards by
// renderMathIn, so a formula that cannot be typeset still reads as source.
function placeholder(tex: string, display: boolean): string {
    const tag = display ? "div" : "span";
    return `<${tag} class="md-math${display ? " md-math-display" : ""}" data-tex="${escapeHtml(tex)}" data-display="${display}">${escapeHtml(tex)}</${tag}>`;
}

function isSpace(code: number): boolean {
    return code === 0x20 || code === 0x09 || code === 0x0a;
}

// $...$ with pandoc's rules, so "costs $5 and $10" is not a formula: the
// opening $ is not followed by a space, the closing $ is not preceded by a
// space and is not followed by a digit.
function dollarInline(state: StateInline, silent: boolean): boolean {
    const src = state.src;
    const start = state.pos;
    if (src.charCodeAt(start) !== 0x24) return false;
    const double = src.charCodeAt(start + 1) === 0x24;
    const open = double ? start + 2 : start + 1;
    if (open >= state.posMax || isSpace(src.charCodeAt(open))) return false;
    let end = open;
    while (end < state.posMax) {
        end = src.indexOf("$", end);
        if (end === -1 || end >= state.posMax) return false;
        let slashes = 0;
        while (src.charCodeAt(end - 1 - slashes) === 0x5c) slashes++;
        if (slashes % 2 === 1) {
            end++;
            continue;
        }
        break;
    }
    const closeLength = double ? 2 : 1;
    if (double && src.charCodeAt(end + 1) !== 0x24) return false;
    if (!double && src.charCodeAt(end + 1) === 0x24) return false;
    if (end === open || isSpace(src.charCodeAt(end - 1))) return false;
    const after = src.charCodeAt(end + closeLength);
    if (after >= 0x30 && after <= 0x39) return false;
    if (!silent) {
        const token = state.push("html_inline", "", 0);
        token.content = placeholder(src.slice(open, end), double);
    }
    state.pos = end + closeLength;
    return true;
}

// \( ... \) and \[ ... \] written inline.
function bracketInline(state: StateInline, silent: boolean): boolean {
    const src = state.src;
    const start = state.pos;
    if (src.charCodeAt(start) !== 0x5c) return false;
    const kind = src.charAt(start + 1);
    if (kind !== "(" && kind !== "[") return false;
    const close = kind === "(" ? "\\)" : "\\]";
    const end = src.indexOf(close, start + 2);
    if (end === -1 || end >= state.posMax) return false;
    const tex = src.slice(start + 2, end);
    if (!tex.trim()) return false;
    if (!silent) {
        const token = state.push("html_inline", "", 0);
        token.content = placeholder(tex.trim(), kind === "[");
    }
    state.pos = end + 2;
    return true;
}

// Display math on its own lines: $$ ... $$ or \[ ... \].
function mathBlock(
    state: StateBlock,
    startLine: number,
    endLine: number,
    silent: boolean,
): boolean {
    let pos = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    if (state.sCount[startLine] - state.blkIndent >= 4) return false;
    const first = state.src.slice(pos, max);
    const opener = first.startsWith("$$")
        ? "$$"
        : first.startsWith("\\[")
          ? "\\["
          : undefined;
    if (!opener) return false;
    const closer = opener === "$$" ? "$$" : "\\]";
    pos += 2;
    let body = state.src.slice(pos, max);
    let line = startLine;
    let closed = false;
    const sameLine = body.trimEnd().endsWith(closer);
    if (sameLine) {
        body = body.trimEnd().slice(0, -closer.length);
        closed = true;
    } else {
        while (++line < endLine) {
            const lineStart = state.bMarks[line] + state.tShift[line];
            const text = state.src.slice(lineStart, state.eMarks[line]);
            if (text.trimEnd().endsWith(closer)) {
                body += `\n${text.trimEnd().slice(0, -closer.length)}`;
                closed = true;
                break;
            }
            body += `\n${text}`;
        }
    }
    if (!closed || !body.trim()) return false;
    if (silent) return true;
    state.line = line + 1;
    const token = state.push("html_block", "", 0);
    token.content = placeholder(body.trim(), true) + "\n";
    token.map = [startLine, state.line];
    return true;
}

export function mathPlugin(md: MarkdownIt): void {
    md.inline.ruler.before("escape", "math_bracket", bracketInline);
    md.inline.ruler.before("escape", "math_dollar", dollarInline);
    md.block.ruler.before("fence", "math_block", mathBlock, {
        alt: ["paragraph", "reference", "blockquote", "list"],
    });
}
