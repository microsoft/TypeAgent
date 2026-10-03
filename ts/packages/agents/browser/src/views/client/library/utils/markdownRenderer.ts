// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import DOMPurify from "dompurify";
import { escapeHtml, highlightCode } from "./codeHighlight";

const ALLOWED_TAGS = [
    "p",
    "br",
    "strong",
    "em",
    "u",
    "s",
    "del",
    "code",
    "pre",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "ul",
    "ol",
    "li",
    "blockquote",
    "hr",
    "a",
    "span",
    "div",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "input",
];

function createRenderer(): MarkdownIt {
    const md = new MarkdownIt({
        html: false, // Disable raw HTML in markdown
        breaks: true, // Convert \n to <br>
        linkify: true, // Auto-convert URLs to links
        typographer: true, // Enable smart quotes and other typographic replacements
        highlight: (code, language) => {
            const lang = language.trim().split(/\s+/)[0];
            const classes = lang ? ` class="language-${escapeHtml(lang)}"` : "";
            return `<pre><code${classes}>${highlightCode(code, lang)}</code></pre>`;
        },
    });

    const defaultLink =
        md.renderer.rules.link_open ||
        function (tokens, idx, options, _env, self) {
            return self.renderToken(tokens, idx, options);
        };
    md.renderer.rules.link_open = (tokens, idx, ...args) => {
        tokens[idx].attrSet("target", "_blank");
        tokens[idx].attrSet("rel", "noopener noreferrer");
        return defaultLink(tokens, idx, ...args);
    };

    // Imported content is untrusted evidence: never load remote images.
    md.renderer.rules.image = (tokens, idx) =>
        `<span class="md-image-omitted">[image: ${escapeHtml(tokens[idx].content || "no description")}]</span>`;

    md.core.ruler.after("inline", "task-list", (state) => {
        const tokens = state.tokens;
        for (let index = 2; index < tokens.length; index++) {
            const inline = tokens[index];
            if (
                inline.type !== "inline" ||
                tokens[index - 1].type !== "paragraph_open" ||
                tokens[index - 2].type !== "list_item_open"
            )
                continue;
            const first = inline.children?.[0];
            const match = /^\[( |x|X)\]\s+/.exec(first?.content ?? "");
            if (!first || first.type !== "text" || !match) continue;
            first.content = first.content.slice(match[0].length);
            const box = new state.Token("html_inline", "", 0);
            box.content = `<input type="checkbox" disabled${match[1] === " " ? "" : " checked"}> `;
            (inline.children as Token[]).unshift(box);
            tokens[index - 2].attrJoin("class", "task-list-item");
        }
        return true;
    });
    return md;
}

/**
 * Render Markdown to sanitized HTML. Supports GitHub-style tables, task lists,
 * strikethrough, rules and syntax-highlighted code. Mermaid fences are left as
 * `pre > code.language-mermaid`; call renderMermaidIn on the container.
 */
export function renderMarkdown(
    markdown: string,
    inline: boolean = false,
): string {
    const md = createRenderer();
    const rawHtml = inline ? md.renderInline(markdown) : md.render(markdown);
    return DOMPurify.sanitize(rawHtml, {
        ALLOWED_TAGS,
        ALLOWED_ATTR: [
            "href",
            "title",
            "target",
            "rel",
            "class",
            "type",
            "checked",
            "disabled",
        ],
        ALLOW_DATA_ATTR: false,
    });
}

/**
 * Render markdown inline (no block elements)
 * @param markdown Inline markdown text
 * @returns Safe HTML string for inline display
 */
export function renderMarkdownInline(markdown: string): string {
    return renderMarkdown(markdown, true);
}
