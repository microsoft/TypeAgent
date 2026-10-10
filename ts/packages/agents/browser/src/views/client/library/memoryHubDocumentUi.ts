// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";

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
        link.target = "_blank";
        link.rel = "noopener noreferrer";
    }
    return container;
}

export function rbError(value: unknown): string {
    return value instanceof Error ? value.message : String(value);
}
