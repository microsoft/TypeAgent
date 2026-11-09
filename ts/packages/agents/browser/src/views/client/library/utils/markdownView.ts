// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { renderMarkdown } from "./markdownRenderer";
import { renderMermaidIn } from "./mermaidView";
import { renderMathIn } from "./mathView";

// Shows Markdown as sanitized HTML with tables, code, diagrams and math.
export function renderMarkdownInto(
    target: HTMLElement,
    markdown: string,
): void {
    target.innerHTML = renderMarkdown(markdown);
    void renderMermaidIn(target);
    void renderMathIn(target);
}
