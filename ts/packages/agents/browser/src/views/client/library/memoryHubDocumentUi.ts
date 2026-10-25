// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { schemaViewPageBrowserLink } from "./memoryHubViewPages";
import { iconButton } from "./memoryHubUi";

export function rbNode<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text?: string,
    className?: string,
): HTMLElementTagNameMap[K] {
    const value = document.createElement(tag);
    if (text !== undefined) value.textContent = text;
    if (className) value.className = className;
    return value;
}

export function rbButton(text: string, handler: () => void, name?: string) {
    const value = rbNode("button", text);
    value.type = "button";
    if (name) value.name = name;
    value.addEventListener("click", handler);
    return value;
}

export function rbIconButton(
    glyph: string,
    label: string,
    handler: () => void,
): HTMLButtonElement {
    return iconButton(glyph, label, handler);
}

export function rbChip(text: string, tone?: string): HTMLSpanElement {
    return rbNode("span", text, `hub-chip${tone ? ` ${tone}` : ""}`);
}

export function rbField(
    label: string,
    value: string,
    onChange: (value: string) => void,
    options: { multiline?: boolean; readonly?: boolean; name?: string } = {},
) {
    const wrapper = rbNode("label", label);
    const control = options.multiline ? rbNode("textarea") : rbNode("input");
    control.value = value;
    control.readOnly = options.readonly ?? false;
    if (options.name) control.name = options.name;
    control.addEventListener("input", () => onChange(control.value));
    wrapper.append(control);
    return wrapper;
}

export function rbMarkdown(value: string) {
    const container = rbNode("div", undefined, "markdown-preview");
    const markdown = new MarkdownIt({ html: false, breaks: true });
    const validateLink = markdown.validateLink.bind(markdown);
    markdown.validateLink = (url) =>
        url.startsWith("memory-view:") || validateLink(url);
    markdown.renderer.rules.link_open = (
        tokens,
        index,
        options,
        _env,
        renderer,
    ) => {
        const href = tokens[index].attrGet("href");
        if (href?.startsWith("memory-view:"))
            tokens[index].attrSet("href", schemaViewPageBrowserLink(href));
        return renderer.renderToken(tokens, index, options);
    };
    container.innerHTML = DOMPurify.sanitize(markdown.render(value), {
        ALLOWED_TAGS: [
            "p",
            "br",
            "strong",
            "em",
            "code",
            "pre",
            "h1",
            "h2",
            "h3",
            "h4",
            "ul",
            "ol",
            "li",
            "blockquote",
            "a",
            "table",
            "thead",
            "tbody",
            "tr",
            "th",
            "td",
        ],
        ALLOWED_ATTR: ["href", "title"],
        ALLOW_DATA_ATTR: false,
    });
    for (const link of container.querySelectorAll("a")) {
        if (link.getAttribute("href")?.startsWith("#/views/")) continue;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
    }
    return container;
}

export function rbError(value: unknown): string {
    return value instanceof Error ? value.message : String(value);
}
