// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";

/**
 * Render markdown to sanitized HTML
 * Based on shell package pattern (packages/shell/src/renderer/src/setContent.ts)
 * @param markdown Markdown text to render
 * @param inline Whether to render inline (no block elements)
 * @returns Safe HTML string
 */
export function renderMarkdown(markdown: string, inline: boolean = false): string {
    // Create markdown-it instance
    const md = new MarkdownIt({
        html: false,        // Disable raw HTML in markdown
        breaks: true,       // Convert \n to <br>
        linkify: true,      // Auto-convert URLs to links
        typographer: true,  // Enable smart quotes and other typographic replacements
    });

    // Customize link rendering to open in new tabs (following shell pattern)
    const defaultRender = md.renderer.rules.link_open ||
        function (tokens, idx, options, _env, self) {
            return self.renderToken(tokens, idx, options);
        };

    md.renderer.rules.link_open = (tokens, idx, ...args) => {
        tokens[idx].attrSet("target", "_blank");
        tokens[idx].attrSet("rel", "noopener noreferrer"); // Security best practice
        return defaultRender(tokens, idx, ...args);
    };

    // Render markdown to HTML
    const rawHtml = inline ? md.renderInline(markdown) : md.render(markdown);

    // Sanitize HTML with DOMPurify (following shell pattern)
    const cleanHtml = DOMPurify.sanitize(rawHtml, {
        ALLOWED_TAGS: [
            'p', 'br', 'strong', 'em', 'u', 'code', 'pre',
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'ul', 'ol', 'li',
            'blockquote',
            'a', 'span', 'div'
        ],
        ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'class'],
        ALLOW_DATA_ATTR: false,
    });

    return cleanHtml;
}

/**
 * Render markdown inline (no block elements)
 * @param markdown Inline markdown text
 * @returns Safe HTML string for inline display
 */
export function renderMarkdownInline(markdown: string): string {
    return renderMarkdown(markdown, true);
}
