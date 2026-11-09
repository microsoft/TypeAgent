// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { renderMarkdown } from "./markdownRenderer";

function render(markdown: string): HTMLElement {
    const host = document.createElement("div");
    host.innerHTML = renderMarkdown(markdown);
    return host;
}

test("GitHub tables keep their structure and alignment-free cells", () => {
    const host = render("| a | b |\n|---|---|\n| 1 | 2 |\n");
    expect(host.querySelectorAll("table thead th")).toHaveLength(2);
    expect(host.querySelector("tbody td")!.textContent).toBe("1");
});

test("code blocks are highlighted for known languages and escaped otherwise", () => {
    const known = render("```ts\nconst x: number = 1;\n```");
    expect(known.querySelector("code.language-ts")).not.toBeNull();
    expect(known.querySelector(".token.keyword")!.textContent).toBe("const");
    const unknown = render("```unknownlang\n<b>x</b>\n```");
    expect(unknown.querySelector("code")!.textContent).toBe("<b>x</b>\n");
    expect(unknown.querySelector("b")).toBeNull();
});

test("mermaid fences stay as code until the diagram renderer runs", () => {
    const host = render("```mermaid\ngraph TD; A-->B\n```");
    expect(host.querySelector("pre > code.language-mermaid")!.textContent).toBe(
        "graph TD; A-->B\n",
    );
});

test("task lists, strikethrough and rules render", () => {
    const host = render("- [x] done\n- [ ] todo\n\n~~gone~~\n\n---\n");
    const boxes = host.querySelectorAll<HTMLInputElement>(
        "li input[type=checkbox]",
    );
    expect(boxes).toHaveLength(2);
    expect(boxes[0].checked).toBe(true);
    expect(boxes[1].checked).toBe(false);
    expect(boxes[0].disabled).toBe(true);
    expect(host.querySelector("s")!.textContent).toBe("gone");
    expect(host.querySelector("hr")).not.toBeNull();
});

test("remote images are never loaded and links open safely", () => {
    const host = render(
        "![diagram <x>](https://example.com/a.png)\n\n[site](https://example.com)",
    );
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector(".md-image-omitted")!.textContent).toBe(
        "[image: diagram <x>]",
    );
    const link = host.querySelector("a")!;
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
});

test("raw HTML and scripts in content are not rendered", () => {
    const host = render(
        "<script>alert(1)</script><img src=x onerror=alert(1)>\n\ntext",
    );
    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("text");
});
